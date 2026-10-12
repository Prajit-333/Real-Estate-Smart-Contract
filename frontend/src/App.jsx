import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, isAddress, parseEther } from "ethers";
import abi from "./contract/abi.json";
import { CONTRACT_ADDRESS } from "./contract/address";
import { friendlyError } from "./utils/errors";
import { hashFile } from "./utils/hash";

const STATES = ["Pending", "Verified", "Rejected", "Paid", "Transferred", "Refunded"];
const EVENT_NAMES = ["PropertyRegistered", "PropertyReRegistered", "PropertyVerified", "PropertyRejected", "PaymentDeposited", "OwnershipTransferred", "PaymentRefunded", "TransferFailed", "VerifierChanged"];
const short = (value) => value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "—";

function StateBadge({ state }) {
  return <span className={`badge state-${state.toLowerCase()}`}>{state}</span>;
}

function EmptyState({ title, text }) {
  return <div className="empty"><strong>{title}</strong><span>{text}</span></div>;
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [network, setNetwork] = useState(null);
  const [admin, setAdmin] = useState("");
  const [verifier, setVerifier] = useState("");
  const [properties, setProperties] = useState([]);
  const [events, setEvents] = useState([]);
  const [balance, setBalance] = useState("0");
  const [notice, setNotice] = useState(null);
  const [hash, setHash] = useState("");
  const [price, setPrice] = useState("");
  const [newVerifier, setNewVerifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("All");
  const [activeView, setActiveView] = useState("market");

  const role = useMemo(() => account && account.toLowerCase() === admin.toLowerCase() ? "Admin" : account && account.toLowerCase() === verifier.toLowerCase() ? "Verifier" : "User", [account, admin, verifier]);
  const wrongNetwork = network && Number(network.chainId) !== 31337;
  const visibleProperties = properties.filter((property) => filter === "All" || STATES[property.state] === filter);
  const pendingCount = properties.filter((property) => property.state === 0).length;
  const verifiedCount = properties.filter((property) => property.state === 1).length;
  const myProperties = properties.filter((property) => property.owner.toLowerCase() === account.toLowerCase());

  const refresh = useCallback(async (activeContract = contract, activeProvider = provider) => {
    if (!activeContract || !activeProvider) return;
    try {
      const code = await activeProvider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") throw new Error(`No contract found at ${CONTRACT_ADDRESS}. Deploy the contract to Hardhat Local, then refresh the page.`);
      const [count, adminAddress, verifierAddress, vaultBalance] = await Promise.all([
        activeContract.propertyCount(), activeContract.admin(), activeContract.verifier(),
        activeProvider.getBalance(CONTRACT_ADDRESS)
      ]);
      const rows = await Promise.all(Array.from({ length: Number(count) }, (_, index) => activeContract.getProperty(index + 1)));
      setAdmin(adminAddress);
      setVerifier(verifierAddress);
      setBalance(formatEther(vaultBalance));
      setProperties(rows.map((row, index) => ({ id: index + 1, owner: row[0], buyer: row[1], price: row[2], docHash: row[3], state: Number(row[4]), held: row[5] })));
      const queried = (await Promise.all(EVENT_NAMES.map(async (name) => (await activeContract.queryFilter(activeContract.filters[name]())).map((event) => ({ name, block: event.blockNumber, args: event.args }))))).flat();
      setEvents(queried.sort((a, b) => b.block - a.block));
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error) });
    }
  }, [contract, provider]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setNotice({ type: "error", text: "Install MetaMask to connect a wallet." });
      return;
    }
    try {
      const nextProvider = new BrowserProvider(window.ethereum);
      await nextProvider.send("eth_requestAccounts", []);
      const nextSigner = await nextProvider.getSigner();
      const nextContract = new Contract(CONTRACT_ADDRESS, abi, nextSigner);
      const nextNetwork = await nextProvider.getNetwork();
      setProvider(nextProvider);
      setAccount(await nextSigner.getAddress());
      setNetwork(nextNetwork);
      setContract(nextContract);
      await refresh(nextContract, nextProvider);
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error) });
    }
  }, [refresh]);

  async function switchToHardhat() {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
    } catch (error) {
      if (error.code === 4902) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0x7a69", chainName: "Hardhat Local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"]
        }] });
      } else {
        setNotice({ type: "error", text: friendlyError(error) });
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    const localProvider = new JsonRpcProvider("http://127.0.0.1:8545");
    const localContract = new Contract(CONTRACT_ADDRESS, abi, localProvider);
    setProvider(localProvider);
    setContract(localContract);
    localProvider.getNetwork().then((nextNetwork) => {
      if (!cancelled) setNetwork(nextNetwork);
      return refresh(localContract, localProvider);
    }).catch((error) => {
      if (!cancelled) setNotice({ type: "error", text: `Cannot read Hardhat Local. Run "npx hardhat node" and deploy the contract. ${friendlyError(error)}` });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!window.ethereum) return undefined;
    const updateAccount = async (accounts) => {
      const nextAccount = accounts[0] || "";
      if (!nextAccount) {
        setAccount("");
        return;
      }
      try {
        const nextProvider = new BrowserProvider(window.ethereum);
        const nextSigner = await nextProvider.getSigner();
        const nextContract = new Contract(CONTRACT_ADDRESS, abi, nextSigner);
        setProvider(nextProvider);
        setAccount(nextAccount);
        setNetwork(await nextProvider.getNetwork());
        setContract(nextContract);
        await refresh(nextContract, nextProvider);
      } catch (error) {
        setNotice({ type: "error", text: friendlyError(error) });
      }
    };
    const onAccountsChanged = (accounts) => updateAccount(accounts);
    const onChainChanged = () => window.location.reload();
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  useEffect(() => { if (contract) refresh(); }, [contract, refresh]);
  useEffect(() => {
    if (!contract) return undefined;
    const listeners = EVENT_NAMES.map((name) => {
      const listener = () => refresh();
      contract.on(name, listener);
      return [name, listener];
    });
    return () => listeners.forEach(([name, listener]) => contract.off(name, listener));
  }, [contract, refresh]);

  async function transact(action, success = "Transaction confirmed") {
    if (wrongNetwork) {
      setNotice({ type: "error", text: "Switch MetaMask to Hardhat Local before sending a transaction." });
      return;
    }
    setBusy(true);
    setNotice({ type: "pending", text: "Confirm the transaction in MetaMask..." });
    try {
      const tx = await action();
      const receipt = await tx.wait();
      const failedTransfer = receipt.logs.some((log) => {
        try { return contract.interface.parseLog(log)?.name === "TransferFailed"; } catch { return false; }
      });
      setNotice({ type: failedTransfer ? "warning" : "success", text: failedTransfer ? "Payment received, but seller payout failed. The verifier can refund the buyer." : success });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function register(event) {
    event.preventDefault();
    try {
      await transact(() => contract.registerProperty(hash.trim(), parseEther(price)), "Property registered and awaiting verification.");
      setHash("");
      setPrice("");
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error) });
    }
  }

  async function fileHash(event) {
    const file = event.target.files?.[0];
    if (file) setHash(await hashFile(file));
  }

  async function resubmit(id) {
    const value = window.prompt("Enter the corrected document hash");
    if (value?.trim()) await transact(() => contract.reRegisterDocument(id, value.trim()), "Document resubmitted for verification.");
  }

  async function changeVerifier() {
    if (!isAddress(newVerifier)) {
      setNotice({ type: "error", text: "Enter a valid verifier address." });
      return;
    }
    await transact(() => contract.changeVerifier(newVerifier), "Verifier updated.");
    setNewVerifier("");
  }

  function actionFor(property) {
    if (!account) return null;
    if (role === "Verifier" && property.state === 0) return <><button disabled={busy} onClick={() => transact(() => contract.verifyProperty(property.id), "Property verified. It is now available to buyers.")}>Approve</button><button className="danger" disabled={busy} onClick={() => transact(() => contract.rejectProperty(property.id), "Property rejected. The owner can resubmit.")}>Reject</button></>;
    if (property.owner.toLowerCase() === account.toLowerCase() && property.state === 2) return <button disabled={busy} onClick={() => resubmit(property.id)}>Resubmit document</button>;
    if (property.state === 1 && property.owner.toLowerCase() !== account.toLowerCase()) return <button disabled={busy} onClick={() => transact(() => contract.purchaseProperty(property.id, { value: property.price }), `Property #${property.id} purchased. Ownership transferred.`)}>Buy for {formatEther(property.price)} ETH</button>;
    if (role === "Verifier" && property.state === 3) return <button className="danger" disabled={busy} onClick={() => transact(() => contract.refundBuyer(property.id), "Buyer refunded.")}>Refund buyer</button>;
    return null;
  }

  return <main>
    <header>
      <div><p className="eyebrow">BLOCKCHAIN REAL ESTATE</p><h1>Vault Registry</h1><p className="muted">A guided workspace for registering, verifying and buying property.</p></div>
      <div className="wallet"><div className="account-info">{account && <><span className="role-dot" /> <span>{role}</span></>}</div><button onClick={connect}>{account ? short(account) : "Connect Wallet"}</button></div>
    </header>
    {wrongNetwork && <div className="alert error"><strong>Wrong network</strong><span>MetaMask is connected to another chain.</span><button onClick={switchToHardhat}>Switch to Hardhat Local</button></div>}
    {notice && <div className={`alert ${notice.type}`}>{notice.text}</div>}

    <nav className="tabs" aria-label="Dashboard sections">
      <button className={activeView === "market" ? "active" : ""} onClick={() => setActiveView("market")}>Marketplace <span>{properties.length}</span></button>
      <button className={activeView === "workspace" ? "active" : ""} onClick={() => setActiveView("workspace")}>My workspace <span>{myProperties.length}</span></button>
      {role === "Verifier" && <button className={activeView === "review" ? "active" : ""} onClick={() => setActiveView("review")}>Review queue <span>{pendingCount}</span></button>}
      <button className={activeView === "activity" ? "active" : ""} onClick={() => setActiveView("activity")}>Activity</button>
    </nav>

    <section className="stats">
      <div><span>Vault balance</span><strong>{balance} ETH</strong></div>
      <div><span>Available to buy</span><strong>{verifiedCount}</strong></div>
      <div><span>Awaiting review</span><strong>{pendingCount}</strong></div>
      <div><span>Connected role</span><strong>{account ? role : "Guest"}</strong></div>
    </section>

    {!account && <section className="hero panel"><div><p className="eyebrow">GET STARTED</p><h2>Connect your wallet to use the registry</h2><p className="muted">Register a property as an owner, approve documents as the verifier, or purchase a verified property as a buyer.</p></div><button onClick={connect}>Connect MetaMask</button></section>}

    {account && activeView === "workspace" && <section className="panel">
      <div className="section-title"><div><h2>Register a property</h2><p className="muted">Your property starts as Pending and must be approved by the verifier.</p></div><StateBadge state="Pending" /></div>
      <form onSubmit={register} className="form"><input placeholder="Document hash or IPFS CID" value={hash} onChange={(e) => setHash(e.target.value)} required /><label className="file">Hash a file<input type="file" onChange={fileHash} /></label><input type="number" min="0" step="0.0001" placeholder="Sale price in ETH" value={price} onChange={(e) => setPrice(e.target.value)} required /><button disabled={busy || wrongNetwork}>Register property</button></form>
      {role === "Admin" && <div className="admin-row"><div><strong>Verifier account</strong><span className="muted mono">{short(verifier)}</span></div><input placeholder="New verifier address" value={newVerifier} onChange={(e) => setNewVerifier(e.target.value)} /><button disabled={busy || wrongNetwork} onClick={changeVerifier}>Update verifier</button></div>}
    </section>}

    {activeView === "review" && role === "Verifier" && <section className="callout"><strong>Verification queue</strong><span>Review the document hash off-chain before approving. Approval makes the property available for purchase.</span></section>}

    {(activeView === "market" || activeView === "workspace" || activeView === "review") && <section>
      <div className="section-title"><div><h2>{activeView === "review" ? "Properties awaiting review" : activeView === "workspace" ? "My properties" : "Property marketplace"}</h2><span className="muted">Verifier: <span className="mono">{short(verifier)}</span></span></div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{STATES.map((state) => <option key={state}>{state}</option>)}</select>
      </div>
      <div className="grid">{visibleProperties.filter((property) => activeView === "review" ? property.state === 0 : activeView === "workspace" ? property.owner.toLowerCase() === account.toLowerCase() : true).map((property) => <article className="card" key={property.id}>
        <div className="card-head"><div><p className="eyebrow">PROPERTY #{property.id}</p><h3>{formatEther(property.price)} ETH</h3></div><StateBadge state={STATES[property.state]} /></div>
        <p className="hash mono" title={property.docHash}>{property.docHash}</p>
        <div className="details"><span>Owner<strong className="mono">{short(property.owner)}</strong></span><span>Buyer<strong className="mono">{short(property.buyer)}</strong></span><span>Held in vault<strong>{formatEther(property.held)} ETH</strong></span><span>Next step<strong>{property.state === 0 ? "Verifier review" : property.state === 1 ? "Buyer purchase" : STATES[property.state]}</strong></span></div>
        <div className="actions">{actionFor(property) || <span className="muted">{property.state === 4 ? "Ownership transferred" : property.state === 5 ? "Funds refunded" : "No action for this account"}</span>}</div>
      </article>)}</div>
      {!visibleProperties.length && <EmptyState title="No properties found" text="Try another filter or register the first property." />}
    </section>}

    {activeView === "activity" && <section className="panel"><div className="section-title"><div><h2>On-chain activity</h2><span className="muted">Every state change is recorded by the contract.</span></div></div>{events.length ? events.map((event, index) => <div className="event" key={`${event.block}-${index}`}><strong>{event.name}</strong><span>Block {event.block}</span><span className="mono">{event.args?.id ? `Property #${event.args.id}` : ""}</span></div>) : <EmptyState title="No activity yet" text="Connect to the deployed contract to view events." />}</section>}
  </main>;
}

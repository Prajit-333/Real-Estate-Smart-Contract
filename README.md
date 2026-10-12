# Real Estate Vault

A decentralized real-estate registration and transaction demo built with Solidity, Hardhat, React, Vite, and ethers.js.

The application allows a property owner to register a property document hash and sale price, a trusted verifier to approve or reject the submitted document, and a buyer to purchase an approved property. When a purchase succeeds, the smart contract automatically updates ownership and sends the sale amount to the previous owner.

> This project is intended for local development and demonstration. It is not production-ready and should not be used to manage real property or real funds without a professional security audit and additional legal, security, and operational controls.

## Features

- Property registration with a document hash or IPFS CID
- Property sale price stored on-chain in wei
- Verifier approval and rejection workflow
- Document resubmission after rejection
- Exact-price purchase validation
- Automatic ownership transfer after purchase
- Automatic seller payout
- Emergency buyer refund path if seller payout fails
- Admin-controlled verifier replacement
- On-chain events for activity tracking
- MetaMask wallet connection
- Responsive blue-and-white frontend
- Hardhat Local development network

## Technology stack

| Layer | Technology |
| --- | --- |
| Smart contract | Solidity `0.8.20` |
| Blockchain tooling | Hardhat |
| Contract interaction | ethers.js `6.x` |
| Frontend | React `18.x` |
| Frontend tooling | Vite |
| Wallet | MetaMask |
| Local network | Hardhat Network, chain ID `31337` |

## Project structure

```text
.
├── contracts/
│   └── RealEstateVault.sol       # Main smart contract
├── scripts/
│   └── deploy.js                 # Local deployment script
├── frontend/
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── App.jsx               # Main dashboard and interaction logic
│       ├── main.jsx
│       ├── styles.css            # Blue-and-white UI styling
│       ├── contract/
│       │   ├── abi.json          # Contract ABI used by the frontend
│       │   └── address.js        # Deployed contract address
│       └── utils/
│           ├── errors.js         # User-friendly transaction errors
│           └── hash.js           # Browser file hashing utility
├── hardhat.config.js
├── package.json
└── README.md
```

## Prerequisites

Install the following before starting:

- Node.js 18 or later
- npm
- MetaMask browser extension

## Installation

Clone or copy the project and install the root dependencies:

```powershell
cd F:\Blockchain
npm install
```

Install the frontend dependencies:

```powershell
cd F:\Blockchain\frontend
npm install
```

Return to the project root before running the local blockchain commands:

```powershell
cd F:\Blockchain
```

## Run the project locally

Use three terminals.

### 1. Start the Hardhat local blockchain

In Terminal 1:

```powershell
cd F:\Blockchain
npx hardhat node
```

Keep this terminal running. Hardhat will print funded test accounts and private keys.

### 2. Deploy the contract

In Terminal 2:

```powershell
cd F:\Blockchain
npm run deploy
```

The deployment script:

- Uses Account #0 as the admin
- Uses Account #1 as the initial verifier
- Deploys `RealEstateVault`
- Writes the deployed address to `frontend/src/contract/address.js`

Example output:

```text
RealEstateVault deployed to: 0x...
Frontend contract address updated: ...
Admin: 0x...
Verifier: 0x...
```

If the Hardhat node is restarted, its state is reset. Deploy the contract again and use the newly generated accounts and address.

### 3. Start the frontend

In Terminal 3:

```powershell
cd F:\Blockchain
npm run frontend
```

Open the Vite URL shown in the terminal. It is usually:

```text
http://localhost:5173
```

## Configure MetaMask

Add the Hardhat Local network to MetaMask:

| Setting | Value |
| --- | --- |
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

Import test accounts into MetaMask using the private keys printed by your own `npx hardhat node` process. Do not use or share private keys from another environment.

Recommended account arrangement:

| Account | Role | Responsibility |
| --- | --- | --- |
| Account #0 | Admin | Deploys the contract and changes the verifier |
| Account #1 | Verifier | Approves or rejects property documents |
| Account #3 | Owner/Seller | Registers and resubmits properties |
| Account #4 | Buyer | Purchases verified properties |

## Complete demo workflow

### 1. Register a property as Account #3

Connect MetaMask using Account #3 and open **My workspace**.

Use:

```text
Document hash: QmDemoPropertyAccount3
Sale price:    5
```

Click **Register property** and confirm the transaction.

The property is created in the `Pending` state. Registration stores the sale price; it does not transfer the sale price to the contract. MetaMask still displays a small gas fee because registration is an on-chain transaction.

### 2. Reject the property as Account #1

Switch MetaMask to Account #1 and open **Review queue**.

Click **Reject** for the pending property. The property moves to the `Rejected` state.

### 3. Resubmit the document as Account #3

Switch back to Account #3 and click **Resubmit document**.

Example corrected hash:

```text
QmDemoPropertyAccount3Corrected
```

The property returns to the `Pending` state.

### 4. Approve the property as Account #1

Switch to Account #1, open **Review queue**, and click **Approve**.

The property moves to the `Verified` state and becomes available for purchase.

### 5. Purchase the property as Account #4

Switch to Account #4 and open **Marketplace**. Click **Buy for 5 ETH** and confirm the transaction.

The buyer sends exactly the listed property price. The contract then:

1. Records the buyer.
2. Transfers the on-chain ownership record to Account #4.
3. Sends the sale amount to the previous owner, Account #3.
4. Changes the property state to `Transferred`.

The purchase amount and the network gas fee are separate values.

### 6. View the activity log

Open **Activity** to see events generated by the contract, including:

- `PropertyRegistered`
- `PropertyRejected`
- `PropertyReRegistered`
- `PropertyVerified`
- `PaymentDeposited`
- `OwnershipTransferred`

## Property state machine

```text
Pending ──approve──> Verified ──purchase──> Paid ──successful payout──> Transferred
   │
   └──reject──> Rejected ──resubmit──> Pending

Paid ──emergency refund──> Refunded
```

The normal purchase path usually moves from `Verified` to `Transferred` in one transaction. The intermediate `Paid` state is used if the seller payout cannot be completed.

## Smart contract functions

### Owner functions

```solidity
registerProperty(string calldata _docHash, uint256 _price)
reRegisterDocument(uint256 _id, string calldata _newDocHash)
```

### Verifier functions

```solidity
verifyProperty(uint256 _id)
rejectProperty(uint256 _id)
refundBuyer(uint256 _id)
```

### Admin functions

```solidity
changeVerifier(address _newVerifier)
```

### Read functions

```solidity
propertyCount()
properties(uint256 _id)
getProperty(uint256 _id)
admin()
verifier()
```

## Important transaction behavior

### Registration

```javascript
contract.registerProperty(
  "QmDemoPropertyAccount3",
  parseEther("5")
);
```

The `5 ETH` value is stored as the future sale price. `registerProperty` is not payable, so the seller does not send 5 ETH during registration.

### Purchase

```javascript
contract.purchaseProperty(propertyId, {
  value: property.price
});
```

The purchase transaction must contain the exact price. Sending too little or too much causes the transaction to revert.

## Build the frontend

From the project root:

```powershell
npm run build
```

This runs the frontend production build and creates the Vite output in `frontend/dist`.

You can also build directly from the frontend directory:

```powershell
cd F:\Blockchain\frontend
npm run build
```

## Compile the smart contract

From the project root:

```powershell
npm run compile
```

Compiled contract artifacts are generated under `artifacts/`.

## Troubleshooting

### Wrong network

Ensure MetaMask is connected to:

```text
Hardhat Local
Chain ID: 31337
RPC: http://127.0.0.1:8545
```

The frontend also provides a **Switch to Hardhat Local** button.

### No contract found

Start the local node and deploy again:

```powershell
npx hardhat node
npm run deploy
```

Refresh the frontend after deployment.

### Account is not authorized

Only the configured verifier can approve, reject, or refund. Only the admin can change the verifier. Confirm that MetaMask is using the expected Hardhat account.

### Owner cannot buy their own property

The seller cannot purchase their own property. Use a different account, such as Account #4, for the buyer demonstration.

### Incorrect payment amount

The buyer must send exactly the listed price. For a property priced at `5 ETH`, the purchase transaction must send exactly `5 ETH`, in addition to the gas fee.

### Local blockchain state was reset

Restarting `npx hardhat node` creates a fresh local blockchain. Redeploy the contract and update the frontend address before continuing.

## Security and production considerations

This is an educational local-network project. Before using a similar design in production, consider:

- Professional Solidity and application security audits
- Real identity, title, and legal document verification
- Secure IPFS or document storage integration
- Role management beyond fixed local accounts
- Production wallet and key management
- Oracle and verifier trust assumptions
- Reentrancy, denial-of-service, and payout failure testing
- Upgrade and migration strategy
- Network fees, confirmations, and transaction monitoring
- Legal compliance for real-estate transactions

The contract stores a document hash, not the actual ownership document. The off-chain document must be independently stored and verified.

## License

This project includes an MIT SPDX identifier in the smart contract. Add a repository-level license file if a formal distribution license is required.

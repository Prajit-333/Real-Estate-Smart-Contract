// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RealEstateVault
 * @notice Trustless real-estate transaction system between a Buyer and a Seller
 *         (property Owner) who never meet physically, mediated by a trusted
 *         off-chain Verifier and enforced on-chain via a vault smart contract.
 *
 * Actors:
 *   - admin     : deploys the contract, appoints/replaces the Verifier
 *   - Owner     : registers a property (seller)
 *   - Verifier  : checks the off-chain document (hash) and approves/rejects it
 *   - Buyer     : pays the exact price into the vault; ownership transfers automatically
 *
 * State machine (per property):
 *   Pending -> Verified -> Paid -> Transferred
 *      |                              ^
 *      +---------> Rejected           |
 *                     |               |
 *                     +---- (owner can re-register with a new doc hash)
 *
 *   Paid -> Refunded   (emergency/manual refund path if a transfer cannot complete)
 */
contract RealEstateVault {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum State {
        Pending,      // 0 - registered, awaiting verification
        Verified,     // 1 - documents approved by verifier
        Rejected,     // 2 - documents rejected by verifier
        Paid,         // 3 - buyer's funds are held in the vault
        Transferred,  // 4 - ownership transferred, seller paid
        Refunded      // 5 - buyer's held funds were refunded
    }

    struct Property {
        uint256 id;
        address payable currentOwner; // seller who receives payment / current title holder
        address buyer;                // set once a buyer pays
        uint256 price;                // exact price required, in wei
        string docHash;               // IPFS/off-chain hash of the ownership document
        State state;
        uint256 heldAmount;       // funds currently held for this property
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public admin;
    address public verifier;

    uint256 public propertyCount;
    mapping(uint256 => Property) public properties;

    // simple reentrancy guard
    bool private locked;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event VerifierChanged(address indexed oldVerifier, address indexed newVerifier);
    event PropertyRegistered(uint256 indexed id, address indexed owner, uint256 price, string docHash);
    event PropertyReRegistered(uint256 indexed id, string newDocHash);
    event PropertyVerified(uint256 indexed id, address indexed verifier);
    event PropertyRejected(uint256 indexed id, address indexed verifier);
    event PaymentDeposited(uint256 indexed id, address indexed buyer, uint256 amount);
    event OwnershipTransferred(uint256 indexed id, address indexed oldOwner, address indexed newOwner, uint256 price);
    event PaymentRefunded(uint256 indexed id, address indexed buyer, uint256 amount);
    event TransferFailed(uint256 indexed id, address indexed seller);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized: admin only");
        _;
    }

    modifier onlyVerifier() {
        require(msg.sender == verifier, "Not authorized: verifier only");
        _;
    }

    modifier onlyPropertyOwner(uint256 _id) {
        require(properties[_id].currentOwner == msg.sender, "Not authorized: property owner only");
        _;
    }

    modifier propertyExists(uint256 _id) {
        require(_id > 0 && _id <= propertyCount, "Property does not exist");
        _;
    }

    modifier inState(uint256 _id, State _state) {
        require(properties[_id].state == _state, "Invalid property state for this action");
        _;
    }

    modifier noReentrancy() {
        require(!locked, "Reentrant call blocked");
        locked = true;
        _;
        locked = false;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _verifier) {
        require(_verifier != address(0), "Verifier address cannot be zero");
        admin = msg.sender;
        verifier = _verifier;
    }

    // ---------------------------------------------------------------------
    // Admin functions
    // ---------------------------------------------------------------------

    function changeVerifier(address _newVerifier) external onlyAdmin {
        require(_newVerifier != address(0), "Verifier address cannot be zero");
        emit VerifierChanged(verifier, _newVerifier);
        verifier = _newVerifier;
    }

    // ---------------------------------------------------------------------
    // Owner (seller) functions
    // ---------------------------------------------------------------------

    /**
     * @notice Register a new property for sale.
     * @param _docHash IPFS/off-chain hash of the ownership document.
     * @param _price   Exact sale price required from the buyer, in wei.
     */
    function registerProperty(string calldata _docHash, uint256 _price) external returns (uint256) {
        require(bytes(_docHash).length > 0, "Document hash required");
        require(_price > 0, "Price must be greater than zero");

        propertyCount++;
        properties[propertyCount] = Property({
            id: propertyCount,
            currentOwner: payable(msg.sender),
            buyer: address(0),
            price: _price,
            docHash: _docHash,
            state: State.Pending,
            heldAmount: 0
        });

        emit PropertyRegistered(propertyCount, msg.sender, _price, _docHash);
        return propertyCount;
    }

    /**
     * @notice Allows the owner to resubmit a corrected document hash after a rejection.
     */
    function reRegisterDocument(uint256 _id, string calldata _newDocHash)
        external
        propertyExists(_id)
        onlyPropertyOwner(_id)
        inState(_id, State.Rejected)
    {
        require(bytes(_newDocHash).length > 0, "Document hash required");
        Property storage p = properties[_id];
        p.docHash = _newDocHash;
        p.state = State.Pending;
        emit PropertyReRegistered(_id, _newDocHash);
    }

    // ---------------------------------------------------------------------
    // Verifier functions
    // ---------------------------------------------------------------------

    function verifyProperty(uint256 _id)
        external
        propertyExists(_id)
        onlyVerifier
        inState(_id, State.Pending)
    {
        properties[_id].state = State.Verified;
        emit PropertyVerified(_id, msg.sender);
    }

    function rejectProperty(uint256 _id)
        external
        propertyExists(_id)
        onlyVerifier
        inState(_id, State.Pending)
    {
        properties[_id].state = State.Rejected;
        emit PropertyRejected(_id, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Buyer functions
    // ---------------------------------------------------------------------

    /**
     * @notice Buyer pays the exact property price into the vault. Ownership
     *         transfer and seller payout happen automatically in this same
     *         transaction once the exact amount is confirmed.
     */
    function purchaseProperty(uint256 _id)
        external
        payable
        propertyExists(_id)
        inState(_id, State.Verified)
        noReentrancy
    {
        Property storage p = properties[_id];

        require(msg.sender != p.currentOwner, "Owner cannot buy their own property");
        require(msg.value == p.price, "Incorrect payment amount: must equal exact price");

        p.buyer = msg.sender;
        p.heldAmount = msg.value;
        p.state = State.Paid;
        emit PaymentDeposited(_id, msg.sender, msg.value);

        _finalizeTransfer(_id);
    }

    /**
     * @dev Internal: releases held funds to the seller and transfers the
     *      on-chain ownership record to the buyer. Runs automatically right
     *      after a successful payment. If the seller's address cannot receive
     *      ETH, the deal is left in the Paid state with the funds still held,
     *      so the verifier can refund the buyer via refundBuyer().
     */
    function _finalizeTransfer(uint256 _id) internal inState(_id, State.Paid) {
        Property storage p = properties[_id];

        address payable oldOwner = p.currentOwner;
        address newOwner = p.buyer;
        uint256 amount = p.heldAmount;

        // Effects before interaction (checks-effects-interactions pattern)
        p.currentOwner = payable(newOwner);
        p.buyer = address(0);
        p.heldAmount = 0;
        p.state = State.Transferred;

        (bool sent, ) = oldOwner.call{value: amount}("");
        if (!sent) {
            // Payout failed: undo the transfer and keep the funds held
            p.currentOwner = oldOwner;
            p.buyer = newOwner;
            p.heldAmount = amount;
            p.state = State.Paid;
            emit TransferFailed(_id, oldOwner);
            return;
        }

        emit OwnershipTransferred(_id, oldOwner, newOwner, amount);
    }

    // ---------------------------------------------------------------------
    // Refund / failure handling
    // ---------------------------------------------------------------------

    /**
     * @notice Emergency refund path: if a property ends up stuck in the Paid
     *         state (e.g. the seller's address cannot receive ETH, so the automatic
     *         payout failed and the funds remain held), the verifier can trigger a refund to the buyer
     *         instead of forcing the transfer through.
     */
    function refundBuyer(uint256 _id)
        external
        propertyExists(_id)
        onlyVerifier
        inState(_id, State.Paid)
        noReentrancy
    {
        Property storage p = properties[_id];

        address buyerAddr = p.buyer;
        uint256 amount = p.heldAmount;
        require(amount > 0, "No held funds to refund");

        // Effects before interaction
        p.buyer = address(0);
        p.heldAmount = 0;
        p.state = State.Refunded;

        (bool sent, ) = payable(buyerAddr).call{value: amount}("");
        require(sent, "Refund transfer failed");

        emit PaymentRefunded(_id, buyerAddr, amount);
    }

    // ---------------------------------------------------------------------
    // View helpers
    // ---------------------------------------------------------------------

    function getProperty(uint256 _id)
        external
        view
        propertyExists(_id)
        returns (
            address currentOwner,
            address buyer,
            uint256 price,
            string memory docHash,
            State state,
            uint256 heldAmount
        )
    {
        Property storage p = properties[_id];
        return (p.currentOwner, p.buyer, p.price, p.docHash, p.state, p.heldAmount);
    }

    // Reject any stray ETH sent directly to the contract (must go through purchaseProperty)
    receive() external payable {
        revert("Direct payments not accepted; use purchaseProperty(id)");
    }

    fallback() external payable {
        revert("Function does not exist");
    }
}

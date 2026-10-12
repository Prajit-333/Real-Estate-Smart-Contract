const messages = {
  "Not authorized: verifier only": "Only the verifier can do this",
  "Not authorized: property owner only": "Only the property owner can do this",
  "Not authorized: admin only": "Only the admin can do this",
  "Invalid property state for this action": "This property is not in the right state for that action",
  "Incorrect payment amount: must equal exact price": "Payment must equal the exact price",
  "Owner cannot buy their own property": "Owners cannot buy their own property",
  "Document hash required": "Please provide a document hash",
  "Price must be greater than zero": "Price must be greater than zero",
  "Property does not exist": "Property not found"
};

export function friendlyError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "Transaction rejected in MetaMask";
  const text = error?.reason || error?.shortMessage || error?.message || "Transaction failed";
  return Object.entries(messages).find(([reason]) => text.includes(reason))?.[1] || text;
}

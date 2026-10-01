// GovChain — Friendly Wallet Error Translator
//
// Wallet / RPC errors (MetaMask, ethers.js) come back as raw JSON meant for
// developers, not citizens or officers. This maps the common ones to plain,
// calm, action-oriented messages that match GovChain's tone elsewhere in the
// app (e.g. "Please switch MetaMask to the Sepolia network to continue.").
//
// Usage in any app.js:
//   showStatus(friendlyWalletError(error), "err");

function friendlyWalletError(error) {
  const code = error && (error.code ?? error.error?.code);
  const rawMessage = (error && (error.shortMessage || error.message || "")) || "";
  const msg = rawMessage.toLowerCase();

  // MetaMask: a connection request is already open and waiting
  if (code === -32002 || msg.includes("already pending")) {
    return "MetaMask already has a connection request waiting for you. Click the MetaMask icon in your browser toolbar, approve or dismiss it, then try again.";
  }

  // User closed the MetaMask popup or clicked "Cancel"
  if (code === 4001 || msg.includes("user rejected") || msg.includes("user denied")) {
    return "The wallet connection was cancelled. Click \"Connect Wallet\" again when you're ready.";
  }

  // Wrong network selected in MetaMask
  if (msg.includes("chain") && (msg.includes("mismatch") || msg.includes("unsupported") || msg.includes("switch"))) {
    return "Your wallet is connected to the wrong network. Please switch to the correct network in MetaMask and try again.";
  }

  // Contract-level permission rejection (e.g. "caller is not an officer")
  if (msg.includes("caller is not") || msg.includes("not authorized") || msg.includes("not an officer")) {
    return "This wallet isn't authorized to perform this action. Please connect with the correct institution account, or contact your administrator.";
  }

  // Not enough Sepolia test ETH / mainnet ETH to pay gas
  if (msg.includes("insufficient funds")) {
    return "This wallet doesn't have enough funds to complete the transaction. Please add funds and try again.";
  }

  // No wallet extension found at all
  if (msg.includes("no ethereum provider") || msg.includes("window.ethereum") || !window.ethereum) {
    return "No wallet was found in this browser. Please install MetaMask and reload the page.";
  }

  // Transaction was submitted but later failed/reverted on-chain for an
  // unrecognized reason
  if (msg.includes("reverted") || msg.includes("execution reverted")) {
    return "The blockchain rejected this action. Please double-check the details and try again, or contact support if this continues.";
  }

  // Network hiccup talking to the RPC provider
  if (msg.includes("network") || msg.includes("timeout") || msg.includes("fetch")) {
    return "We couldn't reach the network just now. Please check your connection and try again in a moment.";
  }

  // Fallback — still calm and non-technical, but honest that something
  // unexpected happened
  return "Something went wrong completing that action. Please try again, and contact support if it keeps happening.";
}

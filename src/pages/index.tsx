import { useWallet } from "@solana/wallet-adapter-react";
// import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// USDUC Mint
const USDUC_MINT = "CB9dDufT3ZuQXqqSfa1c5kY935TEreyBw9XJXxHKpump";
// Wrapped SOL Mint
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Custom wallet button wrapper for USDUC branding
const WalletMultiButtonDynamic = dynamic(
  async () => {
    const mod = await import("@solana/wallet-adapter-react-ui");
    return mod.WalletMultiButton;
  },
  { ssr: false }
);

const UNSTABLE_TAGLINES = [
  "Will you be a millionaire or a hobo?",
  "High Volatility!",
  "Get rich or die trying.",
  "unstable coin, unstable life.",
  "u can't get rich by holding stablecoins",
  "Made for unstable people.",
  "Sleep poor, wake up rich (or not)",
];

function WalletButtonWrapper() {
  return (
    <WalletMultiButtonDynamic
      style={{
        background: "#3498fd",
        color: "#fff",
        borderRadius: "9999px",
        fontWeight: 700,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "1.1rem",
        textAlign: "center",
        boxShadow: "none",
        border: "none",
        letterSpacing: "0",
        textTransform: "none",
      }}
      className="font-sans focus:outline-none unstable-wiggle-btn"
    />
  );
}

function getMintAddress(mint: string) {
  // If the token is SOL, return the wrapped SOL mint address
  if (mint === "SOL") return WSOL_MINT;
  return mint;
}

async function fetchTokenPrices(
  mintAddresses: string[]
): Promise<Record<string, number>> {
  if (mintAddresses.length === 0) return {};
  const ids = mintAddresses.join(",");
  const url = `https://lite-api.jup.ag/price/v2?ids=${ids}`;
  const { data } = await axios.get(url);
  // data.data is a map of mint -> { price }
  const prices: Record<string, number> = {};
  for (const mint in data.data) {
    prices[mint] = parseFloat(data.data[mint].price);
  }
  return prices;
}

async function fetchTokenMetadatas(
  mintAddresses: string[]
): Promise<Record<string, any>> {
  const meta: Record<string, any> = {};
  await Promise.all(
    mintAddresses.map(async (mint) => {
      try {
        const url = `https://lite-api.jup.ag/tokens/v1/token/${mint}`;
        const { data } = await axios.get(url);
        meta[mint] = data;
      } catch (e) {
        meta[mint] = null;
      }
    })
  );
  return meta;
}

async function swapTokenToUSDUC({
  fromMint,
  amount,
  publicKey,
  signTransaction,
}: {
  fromMint: string;
  amount: string; // in raw token units (not UI amount)
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}) {
  // Always use mint addresses for inputMint/outputMint
  const inputMint = getMintAddress(fromMint);
  const outputMint = getMintAddress(USDUC_MINT);
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker: publicKey.toBase58(),
  });
  let orderRes;
  try {
    orderRes = await axios.get(
      `https://lite-api.jup.ag/ultra/v1/order?${params.toString()}`
    );
  } catch (err: any) {
    // If the API returns a 400/500, show the error message
    if (err.response && err.response.data) {
      throw new Error(
        `Jupiter API error: ${JSON.stringify(err.response.data, null, 2)}`
      );
    } else {
      throw new Error("Unknown error from Jupiter API");
    }
  }
  const order = orderRes.data;
  // If the API returns an error or message field, show it
  if (order.error || order.message) {
    throw new Error(`Jupiter API error: ${order.error || order.message}`);
  }
  // If transaction is present, it's an aggregator swap (needs signing/execution)
  if (order.transaction && order.requestId) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(order.transaction, "base64")
    );
    const signedTx = await signTransaction(tx);
    const signedTxBase64 = Buffer.from(signedTx.serialize()).toString("base64");
    // Execute Order
    const execRes = await axios.post(
      "https://lite-api.jup.ag/ultra/v1/execute",
      {
        signedTransaction: signedTxBase64,
        requestId: order.requestId,
      }
    );
    return execRes.data;
  } else if (order.swapType === "rfq") {
    // RFQ swap: no transaction, just return the order response
    return order;
  } else {
    // Show the full response for debugging
    throw new Error(
      `Unknown order response from Jupiter Ultra API: ${JSON.stringify(
        order,
        null,
        2
      )}`
    );
  }
}

const TOKENS_PER_PAGE = 10;

export default function Home() {
  const { publicKey, connected, signTransaction } = useWallet();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [tokenMetas, setTokenMetas] = useState<Record<string, any>>({});
  const [taglineIdx, setTaglineIdx] = useState(0);

  // Fetch balances and prices
  const fetchBalancesAndPrices = async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const url = `https://lite-api.jup.ag/ultra/v1/balances/${publicKey.toBase58()}`;
      const { data } = await axios.get(url);
      // Filter out tokens with zero balance and convert to array
      const filtered = Object.entries(data)
        .filter(([mint, token]: any) => Number(token.uiAmount) > 0)
        .map(([mint, token]: any) => ({ mint, ...token }));
      setTokens(filtered);
      // Fetch prices for all tokens
      const mints = filtered.map((t) => getMintAddress(t.mint));
      const priceMap = await fetchTokenPrices(mints);
      setPrices(priceMap);
      // Fetch token metadata for all tokens
      const metaMap = await fetchTokenMetadatas(mints);
      setTokenMetas(metaMap);
      // Select all by default (except USDUC and SOL)
      const sel: Record<string, boolean> = {};
      for (const t of filtered) {
        const mintAddr = getMintAddress(t.mint);
        sel[t.mint] =
          mintAddr !== getMintAddress(USDUC_MINT) && mintAddr !== WSOL_MINT;
      }
      setSelected(sel);
    } catch (e) {
      setTokens([]);
      setPrices({});
      setSelected({});
      setTokenMetas({});
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchBalancesAndPrices();
    const interval = setInterval(() => {
      setTaglineIdx((i) => (i + 1) % UNSTABLE_TAGLINES.length);
    }, 2500);
    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchBalancesAndPrices();
  };

  const handleSelect = (mint: string) => {
    setSelected((prev) => ({ ...prev, [mint]: !prev[mint] }));
  };

  const handleConvertAll = async () => {
    if (!publicKey || !signTransaction) return;
    setSwapping(true);
    setSwapStatus("Starting swaps...");
    try {
      let swapped = 0;
      // Only swap selected tokens
      const tokensToSwap = tokens.filter((token: any) => selected[token.mint]);
      for (const token of tokensToSwap) {
        setSwapStatus(`Swapping ${token.uiAmount} of ${token.mint}...`);
        const result = await swapTokenToUSDUC({
          fromMint: token.mint,
          amount: token.amount,
          publicKey,
          signTransaction,
        });
        if (result.status === "Success") {
          swapped++;
          setSwapStatus(
            `Swap success! <a href=\"https://solscan.io/tx/${result.signature}\" target=\"_blank\" rel=\"noopener noreferrer\">View on Solscan</a>`
          );
        } else if (result.swapType === "rfq") {
          setSwapStatus(
            `RFQ swap submitted. Details: <pre>${JSON.stringify(
              result,
              null,
              2
            )}</pre>`
          );
        } else {
          setSwapStatus(
            `Swap failed: ${result.error || "Unknown error"} (code: ${
              result.code
            })`
          );
          break;
        }
      }
      if (swapped > 0) {
        setSwapStatus("All selected tokens swapped to USDUC!");
        // Refresh balances after swap
        await fetchBalancesAndPrices();
      } else {
        setSwapStatus("No tokens swapped.");
      }
    } catch (e: any) {
      setSwapStatus("Swap failed: " + (e?.message || "Unknown error"));
    }
    setSwapping(false);
  };

  // Sort tokens by value (USDC) ascending by default
  const sortedTokens = [...tokens].sort((a, b) => {
    const aVal = (a.uiAmount || 0) * (prices[getMintAddress(a.mint)] || 0);
    const bVal = (b.uiAmount || 0) * (prices[getMintAddress(b.mint)] || 0);
    return aVal - bVal;
  });

  // Pagination logic
  const totalPages = Math.ceil(sortedTokens.length / TOKENS_PER_PAGE);
  const paginatedTokens = sortedTokens.slice(
    page * TOKENS_PER_PAGE,
    (page + 1) * TOKENS_PER_PAGE
  );

  // Selected tokens count and total value
  const selectedTokens = sortedTokens.filter((t) => selected[t.mint]);
  const selectedCount = selectedTokens.length;
  const selectedTotalValue = selectedTokens.reduce(
    (sum, t) => sum + (t.uiAmount || 0) * (prices[getMintAddress(t.mint)] || 0),
    0
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center animated-unstable-bg">
      {/* App Header */}
      <header className="w-full flex flex-col items-center py-6 mb-2 bg-white/80 shadow-sm sticky top-0 z-10">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-blue-700 drop-shadow-sm">
          Unstable Yourself
        </h1>
        <p className="text-xs sm:text-sm text-blue-400 mt-1 font-mono min-h-[1.5em] transition-all">
          {UNSTABLE_TAGLINES[taglineIdx]}
        </p>
        {/* Info & Links */}
        <div className="mt-3 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-xs sm:text-sm text-blue-700 font-mono">
          <span className="bg-blue-100 px-2 py-1 rounded-full">
            Fully Powered by Jupiter APIs
          </span>
          <a
            href="https://x.com/usducSOL"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-blue-600 flex items-center gap-1"
          >
            <svg
              width="16"
              height="16"
              fill="currentColor"
              className="inline-block"
            >
              <path d="M15.98 3.19a6.5 6.5 0 0 1-1.89.52A3.3 3.3 0 0 0 15.54 2c-.63.37-1.33.64-2.07.78A3.28 3.28 0 0 0 7.88 5.03a9.32 9.32 0 0 1-6.77-3.43a3.28 3.28 0 0 0 1.01 4.37a3.23 3.23 0 0 1-1.48-.41v.04a3.28 3.28 0 0 0 2.63 3.22a3.3 3.3 0 0 1-.86.11c-.21 0-.42-.02-.62-.06a3.29 3.29 0 0 0 3.07 2.28A6.58 6.58 0 0 1 1.6 13.13a9.29 9.29 0 0 0 5.03 1.47c6.04 0 9.35-5 9.35-9.34c0-.14 0-.28-.01-.42A6.7 6.7 0 0 0 16 3.54a6.5 6.5 0 0 1-2.02.55z" />
            </svg>
            X
          </a>
          <a
            href="https://usduc.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-blue-600"
          >
            website
          </a>
          <a
            href="https://unstable.ink/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-blue-600"
          >
            writings on instability
          </a>
          <a
            href="https://github.com/julianhzhu/unstable-me"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-blue-600 flex items-center gap-1"
          >
            <svg
              width="16"
              height="16"
              fill="currentColor"
              className="inline-block"
              viewBox="0 0 16 16"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.1 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.09.16 1.9.08 2.1.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            check the code yourself
          </a>
        </div>
      </header>
      <main className="w-full flex flex-col items-center flex-1 px-2 sm:px-0">
        <div className="flex flex-col items-center gap-2 w-full max-w-md">
          {/* Only show wallet button here if connected */}
          {connected && publicKey && <WalletButtonWrapper />}
        </div>
        {/* Show friendly welcome if not connected */}
        {!connected || !publicKey ? (
          <div
            className="mt-16 w-full max-w-md bg-white/80 backdrop-blur-md rounded-2xl shadow-xl p-10 border border-blue-100 flex flex-col items-center gap-8 text-center"
            style={{ boxShadow: "0 8px 40px 0 rgba(45,94,255,0.10)" }}
          >
            <img
              src="/usduc-logo.png"
              alt="USDUC Logo"
              className="w-24 h-24 rounded-full shadow-md mb-2 border-4 border-white unstable-logo"
              style={{ margin: "0 auto", background: "#2D5EFF" }}
            />
            <h2 className="text-3xl font-extrabold text-blue-800 tracking-tight mb-2 font-sans">
              Welcome to Unstable Yourself
            </h2>
            <p className="text-[#2D5EFF] text-lg mb-4 font-sans">
              Swap all your tokens to USDUC in one click.
            </p>
            <WalletButtonWrapper />
          </div>
        ) : (
          <div className="mt-4 w-full max-w-md bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-blue-100 flex flex-col gap-2">
            <div className="mb-2 font-mono text-xs sm:text-sm text-blue-700 truncate">
              Wallet: {publicKey.toBase58()}
            </div>
            <div className="mb-4">
              <h2 className="font-bold mb-2 text-blue-800 text-lg sm:text-xl">
                Token Balances
              </h2>
              {loading ? (
                <div>Loading...</div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {paginatedTokens.length === 0 && (
                      <li>No SPL tokens found.</li>
                    )}
                    {paginatedTokens.map((token: any) => {
                      const mintAddr = getMintAddress(token.mint);
                      const price = prices[mintAddr] || 0;
                      const value = price * (token.uiAmount || 0);
                      const meta = tokenMetas[mintAddr];
                      return (
                        <li
                          key={token.mint}
                          className="flex items-center justify-between px-2 py-2 rounded-xl hover:bg-blue-50 transition-all gap-2"
                        >
                          <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={!!selected[token.mint]}
                              onChange={() => handleSelect(token.mint)}
                              disabled={swapping}
                              className="w-5 h-5 accent-blue-600 rounded-md border border-blue-200"
                            />
                            {meta && meta.logoURI ? (
                              <img
                                src={meta.logoURI}
                                alt={meta.symbol || token.mint}
                                className="w-7 h-7 rounded-full border border-gray-200 bg-white flex-shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
                            )}
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-semibold text-blue-900 truncate">
                                {meta && meta.symbol
                                  ? meta.symbol
                                  : token.mint.slice(0, 4)}
                              </span>
                              <span className="text-xs text-gray-500 truncate">
                                {meta && meta.name
                                  ? meta.name
                                  : token.mint.slice(0, 4) +
                                    "..." +
                                    token.mint.slice(-4)}
                              </span>
                            </div>
                            <span className="ml-2 text-xs text-gray-500 font-mono">
                              {token.uiAmount}
                            </span>
                          </label>
                          <span className="text-xs sm:text-sm text-blue-700 font-bold ml-2 min-w-[60px] text-right">
                            $
                            {value.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Pagination controls */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-4">
                      <button
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg disabled:opacity-50 text-xs sm:text-sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        Prev
                      </button>
                      <span className="text-xs sm:text-sm text-blue-700">
                        Page {page + 1} of {totalPages}
                      </span>
                      <button
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg disabled:opacity-50 text-xs sm:text-sm"
                        onClick={() =>
                          setPage((p) => Math.min(totalPages - 1, p + 1))
                        }
                        disabled={page === totalPages - 1}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Selected tokens summary */}
            <div className="mb-2 text-xs sm:text-sm text-blue-700 flex flex-wrap items-center gap-2 justify-between">
              <span>
                Selected: <span className="font-bold">{selectedCount}</span>{" "}
                token{selectedCount !== 1 ? "s" : ""}
              </span>
              <span className="font-bold text-blue-900">
                $
                {selectedTotalValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <button
              className="mt-2 w-full px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-semibold text-base shadow-lg transition-all"
              disabled={selectedCount === 0 || swapping}
              onClick={handleConvertAll}
            >
              {swapping ? "Swapping..." : "Convert Selected to USDUC"}
            </button>
            {swapStatus && (
              <div
                className="mt-4 text-sm text-blue-800 bg-blue-50 rounded-xl p-3 shadow-inner"
                dangerouslySetInnerHTML={{ __html: swapStatus }}
              />
            )}
          </div>
        )}
      </main>
      {/* Place global styles here */}
      <style jsx global>{`
        .animated-unstable-bg {
          background: linear-gradient(
            120deg,
            #f6fbff 0%,
            #e3f0ff 50%,
            #f6fbff 100%
          );
          animation: unstable-bg-move 12s ease-in-out infinite alternate;
        }
        @keyframes unstable-bg-move {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 100% 50%;
          }
        }
        .unstable-logo {
          animation: unstable-wobble 2.2s infinite
            cubic-bezier(0.36, 0.07, 0.19, 0.97);
          will-change: transform;
          transition: filter 0.2s;
        }
        .unstable-logo:hover {
          animation: unstable-shake 0.5s infinite linear;
          filter: brightness(1.15) drop-shadow(0 0 8px #3498fd88);
        }
        @keyframes unstable-wobble {
          0%,
          100% {
            transform: rotate(-4deg) scale(1.01);
          }
          20% {
            transform: rotate(3deg) scale(1.04);
          }
          40% {
            transform: rotate(-2deg) scale(0.98);
          }
          60% {
            transform: rotate(2deg) scale(1.03);
          }
          80% {
            transform: rotate(-1deg) scale(1.01);
          }
        }
        @keyframes unstable-shake {
          0%,
          100% {
            transform: translateX(0) rotate(-2deg);
          }
          10% {
            transform: translateX(-2px) rotate(2deg);
          }
          20% {
            transform: translateX(3px) rotate(-2deg);
          }
          30% {
            transform: translateX(-4px) rotate(2deg);
          }
          40% {
            transform: translateX(4px) rotate(-2deg);
          }
          50% {
            transform: translateX(-3px) rotate(2deg);
          }
          60% {
            transform: translateX(2px) rotate(-2deg);
          }
          70% {
            transform: translateX(-1px) rotate(2deg);
          }
          80% {
            transform: translateX(1px) rotate(-2deg);
          }
          90% {
            transform: translateX(-1px) rotate(2deg);
          }
        }
        .unstable-wiggle-btn {
          transition: transform 0.15s cubic-bezier(0.36, 0.07, 0.19, 0.97),
            box-shadow 0.15s;
        }
        .unstable-wiggle-btn:hover {
          animation: unstable-btn-wiggle 0.5s linear;
          box-shadow: 0 2px 16px 0 #3498fd33;
          filter: brightness(1.08);
        }
        @keyframes unstable-btn-wiggle {
          0%,
          100% {
            transform: translateX(0) scale(1);
          }
          20% {
            transform: translateX(-2px) scale(1.04);
          }
          40% {
            transform: translateX(2px) scale(0.98);
          }
          60% {
            transform: translateX(-2px) scale(1.03);
          }
          80% {
            transform: translateX(2px) scale(1.01);
          }
        }
      `}</style>
    </div>
  );
}

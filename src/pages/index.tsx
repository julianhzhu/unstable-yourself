import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";
import { FiRefreshCw, FiSun, FiMoon, FiCopy, FiCheck } from "react-icons/fi";

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

interface TokenMeta {
  logoURI?: string;
  symbol?: string;
  name?: string;
  [key: string]: unknown;
}

interface TokenInfo {
  mint: string;
  uiAmount: number;
  amount: string;
  [key: string]: unknown;
}

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

function getMintAddress(mint: string): string {
  if (mint === "SOL") return WSOL_MINT;
  return mint;
}

async function fetchTokenPrices(
  mintAddresses: string[]
): Promise<Record<string, number>> {
  if (mintAddresses.length === 0) return {};
  const ids = mintAddresses.join(",");
  const url = `https://lite-api.jup.ag/price/v3?ids=${ids}`;
  const { data } = await axios.get(url);
  const prices: Record<string, number> = {};
  for (const mint in data) {
    if (data[mint] && data[mint].usdPrice != null) {
      prices[mint] = parseFloat(data[mint].usdPrice);
    }
  }
  return prices;
}

async function fetchTokenMetadatas(
  mintAddresses: string[]
): Promise<Record<string, TokenMeta | null>> {
  const meta: Record<string, TokenMeta | null> = {};
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
  amount: string;
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}) {
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
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      (err as any).response?.data
    ) {
      throw new Error(
        `Jupiter API error: ${JSON.stringify(
          (err as any).response.data,
          null,
          2
        )}`
      );
    } else {
      throw new Error("Unknown error from Jupiter API");
    }
  }
  const order = orderRes.data;
  if (order.error || order.message) {
    throw new Error(`Jupiter API error: ${order.error || order.message}`);
  }
  if (order.transaction && order.requestId) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(order.transaction, "base64")
    );
    const signedTx = await signTransaction(tx);
    const signedTxBase64 = Buffer.from(signedTx.serialize()).toString("base64");
    const execRes = await axios.post(
      "https://lite-api.jup.ag/ultra/v1/execute",
      {
        signedTransaction: signedTxBase64,
        requestId: order.requestId,
      }
    );
    return execRes.data;
  } else if (order.swapType === "rfq") {
    return order;
  } else {
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

// Utility to format numbers as K, M, B, etc.
function formatCompactNumber(num: number, decimals = 2): string {
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(decimals) + "B";
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(decimals) + "M";
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(decimals) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export default function Home() {
  const { publicKey, connected, signTransaction } = useWallet();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [tokenMetas, setTokenMetas] = useState<
    Record<string, TokenMeta | null>
  >({});
  const [taglineIdx, setTaglineIdx] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [showTooltipIdx, setShowTooltipIdx] = useState<number | null>(null);

  useEffect(() => {
    // Check system preference on mount
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    setIsDarkMode(prefersDark);
  }, []);

  useEffect(() => {
    // Update body class when dark mode changes
    if (isDarkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Fetch balances and prices
  const fetchBalancesAndPrices = async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const url = `https://lite-api.jup.ag/ultra/v1/balances/${publicKey.toBase58()}`;
      const { data } = await axios.get(url);
      const filtered: TokenInfo[] = Object.entries(data)
        .filter(([, token]) => Number((token as TokenInfo).uiAmount) > 0)
        .map(([mint, token]) => ({
          mint,
          uiAmount: (token as TokenInfo).uiAmount ?? 0,
          amount: (token as TokenInfo).amount ?? "",
          ...(token as Omit<TokenInfo, "mint" | "uiAmount" | "amount">),
        }));

      // Batch SHIELD API calls (max 10 mints per call)
      function chunkArray<T>(arr: T[], size: number): T[][] {
        const res: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
          res.push(arr.slice(i, i + size));
        }
        return res;
      }

      setTokens(filtered);
      const mints = filtered.map((t) => getMintAddress(t.mint));
      const mintChunks = chunkArray(mints, 10);
      let combinedWarnings: Record<string, any[]> = {};
      for (const chunk of mintChunks) {
        const shieldUrl = `https://lite-api.jup.ag/ultra/v1/shield?mints=${chunk.join(
          ","
        )}`;
        const shieldRes = await fetch(shieldUrl).then((res) => res.json());
        combinedWarnings = { ...combinedWarnings, ...shieldRes.warnings };
      }

      // Filter tokens using original mint for SHIELD lookup
      const safeTokens = filtered.filter((t) => {
        const mint = t.mint;
        const warnings: any[] = combinedWarnings[mint] || [];
        const isScam = warnings.some((w: any) => w.type === "NOT_SELLABLE");
        return !isScam;
      });

      setTokens(safeTokens);
      const safeMints = safeTokens.map((t) => getMintAddress(t.mint));
      let priceMap: Record<string, number> = {};
      try {
        priceMap = await fetchTokenPrices(safeMints);
      } catch (e) {
        console.error("[DEBUG] Error fetching priceMap:", e);
      }
      setPrices(priceMap);
      const metaMap = await fetchTokenMetadatas(safeMints);
      setTokenMetas(metaMap);

      // Filter out tokens with less than 1 cent total value (balance * price)
      const minValueTokens = safeTokens.filter((t) => {
        const mint = getMintAddress(t.mint);
        const price = priceMap[mint];
        // Skip tokens with unknown price
        if (price === undefined || price === 0) {
          return false;
        }
        const totalValue = (t.uiAmount || 0) * price;
        return totalValue >= 0.01;
      });
      setTokens(minValueTokens);
      // Default: no tokens selected
      const sel: Record<string, boolean> = {};
      for (const t of minValueTokens) {
        sel[t.mint] = false;
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
      const tokensToSwap = tokens.filter((token) => selected[token.mint]);
      const results: {
        mint: string;
        uiAmount: number;
        status: string;
        message: string;
        signature?: string;
      }[] = [];
      for (const token of tokensToSwap) {
        setSwapStatus(`Swapping ${token.uiAmount} of ${token.mint}...`);
        try {
          const result = await swapTokenToUSDUC({
            fromMint: token.mint,
            amount: token.amount,
            publicKey,
            signTransaction,
          });
          if (result.status === "Success") {
            swapped++;
            results.push({
              mint: token.mint,
              uiAmount: token.uiAmount,
              status: "success",
              message: `Swap success! <a href=\"https://solscan.io/tx/${result.signature}\" target=\"_blank\" rel=\"noopener noreferrer\">View on Solscan</a>`,
              signature: result.signature,
            });
          } else if (result.swapType === "rfq") {
            results.push({
              mint: token.mint,
              uiAmount: token.uiAmount,
              status: "skipped",
              message: `RFQ swap submitted. Details: <pre>${JSON.stringify(
                result,
                null,
                2
              )}</pre>`,
            });
          } else {
            results.push({
              mint: token.mint,
              uiAmount: token.uiAmount,
              status: "failed",
              message: `Swap failed: ${
                result.error || "Unknown error"
              } (code: ${result.code})`,
            });
          }
        } catch (e) {
          results.push({
            mint: token.mint,
            uiAmount: token.uiAmount,
            status: "failed",
            message: `Swap failed: ${(e as Error)?.message || "Unknown error"}`,
          });
        }
      }
      // Build summary HTML
      let summaryHtml = `<div><b>Swap Summary:</b><ul style='margin:0;padding-left:1.2em;'>`;
      for (const r of results) {
        const color =
          r.status === "success"
            ? "#059669"
            : r.status === "failed"
            ? "#dc2626"
            : "#f59e42";
        summaryHtml += `<li style='margin-bottom:0.5em; color:${color}'>${
          r.status === "success" ? "✅" : r.status === "failed" ? "❌" : "⚠️"
        } <b>${r.uiAmount}</b> of <code>${r.mint.slice(0, 4)}...${r.mint.slice(
          -4
        )}</code>: ${r.message}</li>`;
      }
      summaryHtml += `</ul></div>`;
      if (swapped > 0) {
        summaryHtml += `<div style='margin-top:1em;'>All successful swaps have been completed! Your balances will refresh automatically.</div>`;
        await fetchBalancesAndPrices();
      } else {
        summaryHtml += `<div style='margin-top:1em;'>No tokens were successfully swapped.</div>`;
      }
      setSwapStatus(summaryHtml);
    } catch (e: unknown) {
      setSwapStatus(
        "Swap failed: " + ((e as Error)?.message || "Unknown error")
      );
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
  // If page is out of range after filtering, reset to 0
  if (page > 0 && page >= totalPages) {
    setPage(0);
  }

  // Selected tokens count and total value
  const selectedTokens = sortedTokens.filter((t) => selected[t.mint]);
  const selectedCount = selectedTokens.length;
  const selectedTotalValue = selectedTokens.reduce(
    (sum, t) => sum + (t.uiAmount || 0) * (prices[getMintAddress(t.mint)] || 0),
    0
  );

  // Helper to truncate wallet address
  function truncateAddress(addr?: string) {
    if (!addr) return "";
    return addr.slice(0, 4) + "..." + addr.slice(-4);
  }

  // Copy wallet address to clipboard
  const handleCopyAddress = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1200);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center animated-unstable-bg pb-8">
      {/* App Header */}
      <header className="w-full flex flex-col items-center py-6 mb-2 bg-white/80 dark:bg-black/80 shadow-sm sticky top-0 z-10 relative">
        {/* Dark mode toggle at top right */}
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
          aria-label="Toggle dark mode"
        >
          {isDarkMode ? (
            <FiSun className="w-5 h-5 text-blue-700 dark:text-blue-400" />
          ) : (
            <FiMoon className="w-5 h-5 text-blue-700 dark:text-blue-400" />
          )}
        </button>
        <div className="w-full max-w-md flex flex-col items-center px-4">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-blue-700 dark:text-blue-400 drop-shadow-sm text-center">
            Unstable Yourself
          </h1>
          <p className="text-xs sm:text-sm text-blue-400 dark:text-blue-300 mt-1 font-mono min-h-[1.5em] transition-all text-center">
            {UNSTABLE_TAGLINES[taglineIdx]}
          </p>
        </div>
        {/* Info & Links */}
        <div className="mt-3 flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-xs sm:text-sm text-blue-700 dark:text-blue-300 font-mono">
          <span className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded-full">
            Fully Powered by Jupiter APIs, no RPCs
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
            className="mt-16 w-full max-w-md bg-white/80 dark:bg-black/80 backdrop-blur-md rounded-2xl shadow-xl p-10 border border-blue-100 dark:border-blue-900 flex flex-col items-center gap-8 text-center"
            style={{ boxShadow: "0 8px 40px 0 rgba(45,94,255,0.10)" }}
          >
            <Image
              src="/usduc-logo.png"
              alt="USDUC Logo"
              width={96}
              height={96}
              className="w-24 h-24 rounded-full shadow-md mb-2 border-4 border-white unstable-logo"
              style={{ margin: "0 auto", background: "#2D5EFF" }}
              priority
            />
            <h2 className="text-3xl font-extrabold text-blue-800 tracking-tight mb-2 font-sans">
              Welcome to Unstable Yourself
            </h2>
            <p className="text-[#2D5EFF] text-lg mb-4 font-sans">
              Swap all your tokens to USDUC simply.
            </p>
            <WalletButtonWrapper />
          </div>
        ) : (
          <div className="mt-4 w-full max-w-md bg-white dark:bg-black rounded-2xl shadow-lg p-0 sm:p-0 border border-blue-100 dark:border-blue-900 flex flex-col items-center gap-0 relative">
            {/* Refresh button at top right of card */}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              aria-label="Refresh balances"
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 transition disabled:opacity-50 flex-shrink-0 z-10"
            >
              <FiRefreshCw
                className={`w-5 h-5 ${
                  refreshing || loading ? "animate-spin" : ""
                } text-blue-500 dark:text-blue-400`}
              />
            </button>
            <div className="w-full px-6 pt-6 pb-2 flex flex-col items-center"></div>
            <div className="w-full px-6 pb-6 flex flex-col items-center">
              <h2 className="font-bold mb-2 text-blue-800 dark:text-blue-300 text-lg sm:text-xl text-center">
                Token Balances
              </h2>
              {loading ? (
                <div className="text-blue-700 dark:text-blue-300">
                  Loading...
                </div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {paginatedTokens.length === 0 && (
                      <li className="text-blue-700 dark:text-blue-300">
                        No SPL tokens found.
                      </li>
                    )}
                    {paginatedTokens.map((token, idx) => {
                      const mintAddr = getMintAddress(token.mint);
                      const price = prices[mintAddr] || 0;
                      const value = price * (token.uiAmount || 0);
                      const meta = tokenMetas[mintAddr];
                      const isUSDUC = meta && meta.symbol === "USDUC";
                      const isSOL = meta && meta.symbol === "SOL";
                      return (
                        <li
                          key={token.mint}
                          className="grid grid-cols-[32px_32px_1fr_auto_auto] items-center px-2 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/50 transition-all gap-2 relative"
                        >
                          {/* Checkbox column */}
                          {isUSDUC || isSOL ? (
                            <div />
                          ) : (
                            <input
                              type="checkbox"
                              checked={!!selected[token.mint]}
                              onChange={() => handleSelect(token.mint)}
                              disabled={swapping}
                              className="w-5 h-5 accent-blue-600 dark:accent-blue-400 rounded-md border border-blue-200 dark:border-blue-700"
                            />
                          )}
                          {/* Logo column */}
                          {meta && meta.logoURI ? (
                            <img
                              src={meta.logoURI}
                              alt={meta.symbol || token.mint}
                              width={28}
                              height={28}
                              className="w-7 h-7 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0"
                              style={{ objectFit: "cover" }}
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                          )}
                          {/* Symbol/name column */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 truncate">
                              {meta && meta.symbol
                                ? meta.symbol
                                : token.mint.slice(0, 4)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {meta && meta.name
                                ? meta.name
                                : token.mint.slice(0, 4) +
                                  "..." +
                                  token.mint.slice(-4)}
                            </span>
                          </div>
                          {/* Amount column */}
                          <span
                            className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-mono text-right"
                            title={token.uiAmount.toLocaleString(undefined, {
                              maximumFractionDigits: 8,
                            })}
                          >
                            {formatCompactNumber(token.uiAmount, 2)}
                          </span>
                          {/* Value column */}
                          <span
                            className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 font-bold ml-2 min-w-[60px] text-right"
                            title={value.toLocaleString(undefined, {
                              maximumFractionDigits: 8,
                            })}
                          >
                            ${formatCompactNumber(value, 2)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Pagination controls */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-4">
                      <button
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg disabled:opacity-50 text-xs sm:text-sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        Prev
                      </button>
                      <span className="text-xs sm:text-sm text-blue-700 dark:text-blue-300">
                        Page {page + 1} of {totalPages}
                      </span>
                      <button
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg disabled:opacity-50 text-xs sm:text-sm"
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
            <div className="mb-2 text-xs sm:text-sm text-blue-700 dark:text-blue-300 flex flex-wrap items-center gap-2 justify-between">
              <span>
                Selected: <span className="font-bold">{selectedCount}</span>{" "}
                token{selectedCount !== 1 ? "s" : ""}
              </span>
              <span className="font-bold text-blue-900 dark:text-blue-100">
                $
                {selectedTotalValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <button
              className="mt-2 w-full px-4 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-xl shadow font-semibold text-base hover:bg-blue-700 dark:hover:bg-blue-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={selectedCount === 0 || swapping}
              onClick={handleConvertAll}
            >
              {swapping ? "Swapping..." : "Convert Selected to USDUC"}
            </button>
            {swapStatus && (
              <div
                className="mt-4 text-sm text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/50 rounded-xl p-3 shadow-inner"
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
        .dark .animated-unstable-bg {
          background: linear-gradient(
            120deg,
            #0a0a0a 0%,
            #1a1a1a 50%,
            #0a0a0a 100%
          );
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

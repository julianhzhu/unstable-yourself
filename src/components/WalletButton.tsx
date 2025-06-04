import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () => {
    const mod = await import("@solana/wallet-adapter-react-ui");
    return mod.WalletMultiButton;
  },
  { ssr: false }
);

export default function WalletButton() {
  return <WalletMultiButtonDynamic />;
}

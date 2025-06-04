import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SolanaProvider } from "@/components/SolanaProvider";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SolanaProvider>
      <Component {...pageProps} />
    </SolanaProvider>
  );
}

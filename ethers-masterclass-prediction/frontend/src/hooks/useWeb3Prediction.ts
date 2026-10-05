import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";

import {
  PredictionEventLog,
  PredictionMarketData,
  WalletState,
} from "../types/prediction";

import {
  PREDICTION_HUB_ADDRESS,
  PREDICTION_HUB_ABI,
} from "../contracts/predictionConfig";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const SEPOLIA_CHAIN_ID = 11155111;

// EIP-6963 wallet discovery with window.ethereum fallback
const getWalletProvider = async (): Promise<any | null> => {
  if (!window.ethereum) {
    return new Promise((resolve) => {
      const providers: any[] = [];

      const handleAnnouncement = (event: Event) => {
        const detail = (event as CustomEvent).detail;

        if (detail?.provider) {
          providers.push(detail);
        }
      };

      window.addEventListener("eip6963:announceProvider", handleAnnouncement);

      window.dispatchEvent(new Event("eip6963:requestProvider"));

      setTimeout(() => {
        window.removeEventListener(
          "eip6963:announceProvider",
          handleAnnouncement,
        );

        const metaMask = providers.find(
          (item) => item.info?.rdns === "io.metamask",
        );

        resolve(
          metaMask?.provider ??
            providers[0]?.provider ??
            window.ethereum ??
            null,
        );
      }, 200);
    });
  }

  return window.ethereum;
};

export const useWeb3Wallet = () => {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    chainId: null,
    balance: "0.00",
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  const connectWallet = async () => {
    const walletProvider = await getWalletProvider();

    if (!walletProvider) {
      setWallet((prev) => ({
        ...prev,
        error: "No Web3 wallet detected",
      }));
      return;
    }

    setWallet((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }));

    try {
      const provider = new BrowserProvider(walletProvider);

      await provider.send("eth_requestAccounts", []);

      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      if (chainId !== SEPOLIA_CHAIN_ID) {
        setWallet((prev) => ({
          ...prev,
          chainId,
          isConnected: false,
          isConnecting: false,
          error: "Please switch your wallet to Sepolia",
        }));
        return;
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const balanceWei = await provider.getBalance(address);
      const balance = Number(formatEther(balanceWei)).toFixed(5);

      setWallet({
        address,
        chainId,
        balance,
        isConnected: true,
        isConnecting: false,
        error: null,
      });
    } catch (error: any) {
      setWallet((prev) => ({
        ...prev,
        isConnecting: false,
        error:
          error?.code === "ACTION_REJECTED"
            ? "Wallet connection was rejected"
            : error?.shortMessage ||
              error?.message ||
              "Failed to connect wallet",
      }));
    }
  };

  return { wallet, connectWallet };
};

export const usePredictionMarket = (walletAddress: string | null) => {
  const [markets, setMarkets] = useState<PredictionMarketData[]>([]);
  const [events, setEvents] = useState<PredictionEventLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkets = useCallback(async () => {
    if (!walletAddress || !window.ethereum) return;

    setIsLoading(true);
    setError(null);

    try {
      const provider = new BrowserProvider(window.ethereum);

      const contract = new Contract(
        PREDICTION_HUB_ADDRESS,
        PREDICTION_HUB_ABI,
        provider,
      );

      const allMarkets = await contract.getAllMarkets();

      const formattedMarkets: PredictionMarketData[] = [];

      for (const market of allMarkets) {
        const userBet = await contract.userBets(market.id, walletAddress);

        const winnings = await contract.calculateWinnings(
          market.id,
          walletAddress,
        );

        const endTime = Number(market.endTime);

        formattedMarkets.push({
          id: Number(market.id),
          title: market.title,
          category: market.category,
          endTime,
          outcome: Number(market.outcome),
          totalYesPool: formatEther(market.totalYesPool),
          totalNoPool: formatEther(market.totalNoPool),
          resolved: market.resolved,
          userYesBet: formatEther(userBet.yesAmount),
          userNoBet: formatEther(userBet.noAmount),
          userClaimed: userBet.claimed,
          userEstimatedWinnings: formatEther(winnings),
          isExpired: endTime <= Math.floor(Date.now() / 1000),
        });
      }

      setMarkets(formattedMarkets);
    } catch (error: any) {
      setError(
        error?.shortMessage || error?.message || "Failed to fetch markets",
      );
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      fetchMarkets();
    }
  }, [walletAddress, fetchMarkets]);

  const placeBet = async (
    marketId: number,
    isYes: boolean,
    amountEth: string,
  ) => {
    if (!window.ethereum) {
      setError("No Web3 wallet detected");
      return;
    }

    try {
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new Contract(
        PREDICTION_HUB_ADDRESS,
        PREDICTION_HUB_ABI,
        signer,
      );

      const tx = await contract.placeBet(marketId, isYes, {
        value: parseEther(amountEth),
      });

      await tx.wait();

      await fetchMarkets();
    } catch (error: any) {
      console.error("Bet failed:", error);

      setError(
        error?.code === "ACTION_REJECTED"
          ? "Transaction rejected"
          : error?.shortMessage ||
              error?.reason ||
              error?.message ||
              "Failed to place bet",
      );
    }
  };

  const claimWinnings = async (marketId: number) => {
    if (!window.ethereum) {
      setError("No Web3 wallet detected");
      return;
    }

    try {
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new Contract(
        PREDICTION_HUB_ADDRESS,
        PREDICTION_HUB_ABI,
        signer,
      );

      const tx = await contract.claimWinnings(marketId);

      await tx.wait();

      await fetchMarkets();
    } catch (error: any) {
      console.error("Claim failed:", error);

      setError(
        error?.code === "ACTION_REJECTED"
          ? "Transaction rejected"
          : error?.shortMessage ||
              error?.reason ||
              error?.message ||
              "Failed to claim winnings",
      );
    }
  };

  const createMarket = async (
    title: string,
    category: string,
    durationSeconds: number,
  ) => {
    if (!window.ethereum) {
      setError("No Web3 wallet detected");
      return;
    }

    try {
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new Contract(
        PREDICTION_HUB_ADDRESS,
        PREDICTION_HUB_ABI,
        signer,
      );

      const tx = await contract.createMarket(title, category, durationSeconds);

      await tx.wait();

      await fetchMarkets();
    } catch (error: any) {
      console.error("Create market failed:", error);

      setError(
        error?.code === "ACTION_REJECTED"
          ? "Transaction rejected"
          : error?.shortMessage ||
              error?.reason ||
              error?.message ||
              "Failed to create market",
      );
    }
  };

  // Real-time contract events
  useEffect(() => {
    if (!walletAddress || !window.ethereum) return;

    const provider = new BrowserProvider(window.ethereum);

    const contract = new Contract(
      PREDICTION_HUB_ADDRESS,
      PREDICTION_HUB_ABI,
      provider,
    );

    const addEvent = async (
      type: PredictionEventLog["type"],
      marketId: number,
      event: any,
      extra: {
        user?: string;
        amount?: string;
        outcome?: string;
      } = {},
    ) => {
      const blockNumber = Number(
        event?.blockNumber ?? event?.log?.blockNumber ?? 0,
      );

      const transactionHash =
        event?.transactionHash ?? event?.log?.transactionHash ?? "";

      let timestamp = new Date().toISOString();

      if (blockNumber > 0) {
        try {
          const block = await provider.getBlock(blockNumber);

          if (block) {
            timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
          }
        } catch {
          // Keep current timestamp if block lookup fails
        }
      }

      const newEvent: PredictionEventLog = {
        id: `${transactionHash}-${type}`,
        type,
        marketId,
        user: extra.user,
        amount: extra.amount,
        outcome: extra.outcome,
        blockNumber,
        transactionHash,
        timestamp,
      };

      setEvents((prev) => [newEvent, ...prev].slice(0, 50));
      await fetchMarkets();
    };

    const handleMarketCreated = async (
      marketId: bigint,
      _title: string,
      _category: string,
      _endTime: bigint,
      event: any,
    ) => {
      await addEvent("MarketCreated", Number(marketId), event);
    };

    const handleBetPlaced = async (
      marketId: bigint,
      user: string,
      isYes: boolean,
      amount: bigint,
      event: any,
    ) => {
      await addEvent("BetPlaced", Number(marketId), event, {
        user,
        amount: formatEther(amount),
      });
    };

    const handleMarketResolved = async (
      marketId: bigint,
      outcome: number,
      event: any,
    ) => {
      await addEvent("MarketResolved", Number(marketId), event, {
        outcome: String(Number(outcome)),
      });
    };

    const handleWinningsClaimed = async (
      marketId: bigint,
      user: string,
      amount: bigint,
      event: any,
    ) => {
      await addEvent("WinningsClaimed", Number(marketId), event, {
        user,
        amount: formatEther(amount),
      });
    };

    contract.on("MarketCreated", handleMarketCreated);

    contract.on("BetPlaced", handleBetPlaced);

    contract.on("MarketResolved", handleMarketResolved);

    contract.on("WinningsClaimed", handleWinningsClaimed);

    return () => {
      contract.off("MarketCreated", handleMarketCreated);

      contract.off("BetPlaced", handleBetPlaced);

      contract.off("MarketResolved", handleMarketResolved);

      contract.off("WinningsClaimed", handleWinningsClaimed);
    };
  }, [walletAddress, fetchMarkets]);

  return {
    markets,
    events,
    isLoading,
    error,
    placeBet,
    claimWinnings,
    createMarket,
    fetchMarkets,
  };
};

import { protocolABI } from "./abi";
import { getContractAddress } from "./ens";
import * as ethers from "ethers";

const ALCHEMY_KEY = process.env.ALCHEMY_KEY;
const IPFS_URL = process.env.IPFS_URL;

interface PKP {
  tokenId: string;
  publicKey: string;
  ethAddress: string;
}

export const getProtocolInfo = async (dev: boolean) => {
  try {
    const ensName = dev ? "dev.--protocol.eth" : "--protocol.eth";

    const addr = await getContractAddress(ensName);

    if (!addr || addr === "false") {
      return JSON.stringify({
        success: false,
        error: "Failed to get contract address",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider({
      url: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    });

    const contract = new ethers.Contract(addr, protocolABI, provider);

    const configCid = await contract.getConfig();

    if (!configCid || configCid === "0x") {
      console.log("Protocol info error: Config returned empty value");
      return JSON.stringify({
        success: false,
        error: "Config returned empty value",
      });
    }

    const configResponse = await fetch(
      `${IPFS_URL}/api/v0/cat?arg=${configCid}`,
      {
        method: "POST",
      },
    );
    if (!configResponse.ok) {
      const error = `Failed to fetch config from IPFS: ${configResponse.statusText}`;
      console.log("Protocol info error:", error);
      return JSON.stringify({
        success: false,
        error,
      });
    }
    const configText = await configResponse.text();

    let config: Record<string, any>;
    try {
      config = JSON.parse(configText);
    } catch (e) {
      return JSON.stringify({
        success: false,
        error: "Invalid config JSON",
      });
    }

    const pkpBytes = await contract.getPKP();

    const pkp: PKP = {
      tokenId: tokenIDFromBytes(pkpBytes),
      publicKey: publicKeyFromBytes(pkpBytes),
      ethAddress: addressFromBytes(pkpBytes),
    };

    const litActionMain = await contract.getLitActionMain();
    const litActionRootUpdate = await contract.getLitActionRootUpdate();
    const litActionRenderer = await contract.getLitActionRenderer();

    const result = {
      addr,
      config,
      pkp,
      lit_action_main: litActionMain,
      lit_action_root_update: litActionRootUpdate,
      lit_action_renderer: litActionRenderer,
    };

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log("Protocol info error:", errorMsg);
    return JSON.stringify({
      success: false,
      error: errorMsg,
    });
  }
};

export const tokenIDFromBytes = (bytes: string): string => {
  // I Doubt this can actualy be done .. and probably we wont need it anyway
  return "";
};

export const publicKeyFromBytes = (bytes: string): string => {
  return ethers.utils.hexlify(bytes);
};

export const addressFromBytes = (
  publicKeyBytes: Uint8Array | string,
): string => {
  const pubKeyHex = ethers.utils.hexlify(publicKeyBytes);

  const uncompressedKey = pubKeyHex.startsWith("0x04")
    ? pubKeyHex.slice(4)
    : pubKeyHex.replace(/^0x/, "");

  const hash = ethers.utils.keccak256("0x" + uncompressedKey);
  const rawAddress = "0x" + hash.slice(-40);
  return ethers.utils.getAddress(rawAddress);
};

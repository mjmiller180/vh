import { SettingsMgr } from "/scripts/core/services/SettingsMgrCompat.js";
var Settings = new SettingsMgr();

class CryptoKeysError extends Error {
	constructor(message, cause) {
		super(message + " (caused by: " + cause + ")");
		this.name = "CryptoKeysError";
		this.cause = cause;
	}
}

class CryptoKeys {
	static #instance = null;
	#keysReady = null; // Promise that resolves when keys are ready

	constructor() {
		if (CryptoKeys.#instance) {
			// Return the existing instance if it already exists
			return CryptoKeys.#instance;
		}
		// Initialize the instance if it doesn't exist
		CryptoKeys.#instance = this;

		// Initialize keys in constructor to avoid race conditions
		this.#keysReady = this.#initializeKeys();
	}

	async #initializeKeys() {
		try {
			await Settings.waitForLoad(); // Ensure settings are loaded before accessing them

			const storedEcdsaPrivateKey = Settings.get("crypto.privateKey", false);
			const storedEcdsaPublicKey = Settings.get("crypto.publicKey", false);
			const storedRsaPrivateKey = Settings.get("crypto.rsaPrivateKey", false);
			const storedRsaPublicKey = Settings.get("crypto.rsaPublicKey", false);

			// If any key is missing, regenerate all to ensure they're complete
			if (!storedEcdsaPrivateKey || !storedEcdsaPublicKey || !storedRsaPrivateKey || !storedRsaPublicKey) {
				await this.#generateKeypair();
			} else {
				// Validate that stored keys can be imported successfully
				try {
					// Test ECDSA keys
					const ecdsaPrivateKey = await crypto.subtle.importKey(
						"jwk",
						storedEcdsaPrivateKey,
						{ name: "ECDSA", namedCurve: "P-256" },
						true,
						["sign"]
					);
					const ecdsaPublicKey = await crypto.subtle.importKey(
						"jwk",
						storedEcdsaPublicKey,
						{ name: "ECDSA", namedCurve: "P-256" },
						true,
						["verify"]
					);

					// Test RSA keys
					const rsaPrivateKey = await crypto.subtle.importKey(
						"jwk",
						storedRsaPrivateKey,
						{ name: "RSA-OAEP", hash: "SHA-256" },
						true,
						["decrypt"]
					);
					const rsaPublicKey = await crypto.subtle.importKey(
						"jwk",
						storedRsaPublicKey,
						{ name: "RSA-OAEP", hash: "SHA-256" },
						true,
						["encrypt"]
					);

					// Test if the ECDSA keys are actually a matching pair
					const testData = new TextEncoder().encode("key_pair_test");
					const testSignature = await crypto.subtle.sign(
						{ name: "ECDSA", hash: { name: "SHA-256" } },
						ecdsaPrivateKey,
						testData
					);
					const testVerification = await crypto.subtle.verify(
						{ name: "ECDSA", hash: { name: "SHA-256" } },
						ecdsaPublicKey,
						testSignature,
						testData
					);

					if (!testVerification) {
						await this.#generateKeypair();
					}
				} catch (error) {
					console.warn("Stored keys are corrupted, regenerating:", error);
					await this.#generateKeypair();
				}
			}
		} catch (error) {
			console.error("Failed to initialize keys:", error);
			throw new CryptoKeysError("Failed to initialize keys", error);
		}
	}

	async #generateKeypair() {
		try {
			// Generate ECDSA key pair for signing/verification
			const ecdsaKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
				"sign",
				"verify",
			]);

			// Generate RSA key pair for encryption/decryption
			const rsaKeyPair = await crypto.subtle.generateKey(
				{
					name: "RSA-OAEP",
					modulusLength: 2048,
					publicExponent: new Uint8Array([1, 0, 1]),
					hash: "SHA-256",
				},
				true,
				["encrypt", "decrypt"]
			);

			// Export the ECDSA keys and store them atomically
			const ecdsaPublicKey = await crypto.subtle.exportKey("jwk", ecdsaKeyPair.publicKey);
			const ecdsaPrivateKey = await crypto.subtle.exportKey("jwk", ecdsaKeyPair.privateKey);

			// Export the RSA keys and store them atomically
			const rsaPublicKey = await crypto.subtle.exportKey("jwk", rsaKeyPair.publicKey);
			const rsaPrivateKey = await crypto.subtle.exportKey("jwk", rsaKeyPair.privateKey);

			await Settings.set("crypto.privateKey", ecdsaPrivateKey);
			await Settings.set("crypto.publicKey", ecdsaPublicKey);
			await Settings.set("crypto.rsaPrivateKey", rsaPrivateKey);
			await Settings.set("crypto.rsaPublicKey", rsaPublicKey);

			//Verify that the keys were save correctly
			const storedEcdsaPrivateKey = Settings.get("crypto.privateKey", false);
			const storedEcdsaPublicKey = Settings.get("crypto.publicKey", false);
			const storedRsaPrivateKey = Settings.get("crypto.rsaPrivateKey", false);
			const storedRsaPublicKey = Settings.get("crypto.rsaPublicKey", false);

			if (!storedEcdsaPrivateKey || !storedEcdsaPublicKey || !storedRsaPrivateKey || !storedRsaPublicKey) {
				throw new Error("Keys were not properly stored after generation");
			}

			return { ecdsa: ecdsaKeyPair, rsa: rsaKeyPair };
		} catch (error) {
			console.error("Failed to generate key pair:", error);
			throw new CryptoKeysError("Failed to generate key pair", error);
		}
	}

	async getPrivateKey() {
		try {
			// Wait for keys to be ready
			await this.#keysReady;

			const storedPrivateKey = Settings.get("crypto.privateKey", false);
			if (!storedPrivateKey) {
				throw new CryptoKeysError("Private key not available after initialization");
			}

			const cryptoKey = await crypto.subtle.importKey(
				"jwk",
				storedPrivateKey,
				{ name: "ECDSA", namedCurve: "P-256" },
				true,
				["sign"]
			);
			return cryptoKey;
		} catch (error) {
			if (error instanceof CryptoKeysError) {
				throw error;
			}
			throw new CryptoKeysError("Failed to get private key", error);
		}
	}

	async getPublicKey() {
		try {
			// Wait for keys to be ready
			await this.#keysReady;

			const storedPublicKey = Settings.get("crypto.publicKey", false);
			if (!storedPublicKey) {
				throw new CryptoKeysError("Public key not available after initialization");
			}

			// Import the key first
			const cryptoKey = await crypto.subtle.importKey(
				"jwk",
				storedPublicKey,
				{ name: "ECDSA", namedCurve: "P-256" },
				true,
				["verify"]
			);

			return cryptoKey;
		} catch (error) {
			if (error instanceof CryptoKeysError) {
				throw error;
			}
			throw new CryptoKeysError("Failed to get public key", error);
		}
	}

	async getExportedPublicKey() {
		const publicKey = await this.getPublicKey();
		// Export the key in a format suitable for transmission
		const exportedKey = await crypto.subtle.exportKey("jwk", publicKey);

		return exportedKey;
	}

	async importPublicKeyFromJWK(jwkKey) {
		try {
			return await crypto.subtle.importKey("jwk", jwkKey, { name: "ECDSA", namedCurve: "P-256" }, true, [
				"verify",
			]);
		} catch (error) {
			throw new CryptoKeysError("Failed to import public key from JWK", error);
		}
	}

	/**
	 * Verifies data signature using a public key JWK
	 * @param {object} publicKeyJWK - Public key in JWK format (from getExportedPublicKey)
	 * @param {string|object} data - The data that was signed
	 * @param {string} signatureBase64 - The signature in base64 format
	 * @returns {boolean} True if signature is valid, false otherwise
	 */
	async verifyData(publicKeyJWK, data, signatureBase64) {
		try {
			// Convert the JWK to a CryptoKey
			const publicKey = await this.importPublicKeyFromJWK(publicKeyJWK);

			// Convert data to the same format as signing
			const dataString = typeof data === "string" ? data : JSON.stringify(data);

			const encoder = new TextEncoder();
			const dataBuffer = encoder.encode(dataString);

			// Convert signature from base64 to ArrayBuffer
			const signatureBuffer = this.base64ToBuffer(signatureBase64);

			// Verify the signature
			const isValid = await crypto.subtle.verify(
				{ name: "ECDSA", hash: { name: "SHA-256" } },
				publicKey,
				signatureBuffer,
				dataBuffer
			);

			return isValid;
		} catch (error) {
			console.error("verifyData error:", error);
			throw new CryptoKeysError("Failed to verify data signature", error);
		}
	}

	/**
	 * Signs the data using the private key
	 * @param {string|object} data - The data to sign (will be JSON stringified if object)
	 * @returns {string} The signed data in base64 format
	 */
	async signData(data) {
		try {
			// Convert object to JSON string if necessary
			const dataString = typeof data === "string" ? data : JSON.stringify(data);

			// Convert string to ArrayBuffer
			const encoder = new TextEncoder();
			const dataBuffer = encoder.encode(dataString);

			const privateKey = await this.getPrivateKey();
			const signature = await crypto.subtle.sign(
				{ name: "ECDSA", hash: { name: "SHA-256" } },
				privateKey,
				dataBuffer
			);

			// Convert ArrayBuffer to base64 string
			const signatureBase64 = this.bufferToBase64(signature);

			return signatureBase64;
		} catch (error) {
			throw new CryptoKeysError("Failed to sign data: ", error);
		}
	}

	/**
	 * Converts an ArrayBuffer to a base64 string
	 * @param {ArrayBuffer} buffer - The buffer to convert
	 * @returns {string} The base64 encoded string
	 */
	bufferToBase64(buffer) {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * Converts a base64 string back to an ArrayBuffer
	 * @param {string} base64 - The base64 string to convert
	 * @returns {ArrayBuffer} The decoded buffer
	 */
	base64ToBuffer(base64) {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	}

	async deleteKeys() {
		await Settings.set("crypto.publicKey", null);
		await Settings.set("crypto.privateKey", null);
		await Settings.set("crypto.rsaPublicKey", null);
		await Settings.set("crypto.rsaPrivateKey", null);
		// Re-initialize keys after deletion
		this.#keysReady = this.#initializeKeys();
		await this.#keysReady;
	}

	async waitForLoad() {
		return this.#keysReady;
	}

	/**
	 * Encrypts JSON data using hybrid encryption (RSA + AES)
	 * @param {any} data - The JSON data to encrypt (will be stringified)
	 * @returns {Promise<string>} The encrypted data in base64 format
	 * @throws {CryptoKeysError} If encryption fails
	 */
	async encryptJSON(data) {
		try {
			await this.waitForLoad();

			const rsaPublicKey = await Settings.get("crypto.rsaPublicKey");
			if (!rsaPublicKey) {
				await this.#generateKeypair();
				const newRsaPublicKey = await Settings.get("crypto.rsaPublicKey");
				if (!newRsaPublicKey) {
					throw new CryptoKeysError("Failed to generate RSA public key for encryption");
				}
			}

			// Convert JSON data to buffer
			const encoder = new TextEncoder();
			const dataBuffer = encoder.encode(JSON.stringify(data));

			// Check if data is too large for RSA direct encryption
			if (dataBuffer.byteLength > 190) {
				return await this.#encryptLargeData(dataBuffer, rsaPublicKey);
			}

			// Import the RSA public key
			const cryptoKey = await crypto.subtle.importKey(
				"jwk",
				rsaPublicKey,
				{
					name: "RSA-OAEP",
					hash: "SHA-256",
				},
				true,
				["encrypt"]
			);

			// Encrypt the data directly with RSA
			const encryptedBuffer = await crypto.subtle.encrypt(
				{
					name: "RSA-OAEP",
				},
				cryptoKey,
				dataBuffer
			);

			// Convert to base64
			return this.bufferToBase64(encryptedBuffer);
		} catch (error) {
			console.error("encryptJSON data:", data);
			throw new CryptoKeysError("Failed to encrypt data: ", error);
		}
	}

	/**
	 * Encrypts large data using hybrid encryption (RSA + AES)
	 * @param {ArrayBuffer} dataBuffer - The data to encrypt
	 * @param {object} rsaPublicKey - The RSA public key JWK
	 * @returns {Promise<string>} The encrypted data in base64 format
	 */
	async #encryptLargeData(dataBuffer, rsaPublicKey) {
		try {
			// Generate a random AES key
			const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
				"encrypt",
				"decrypt",
			]);

			// Generate a random IV
			const iv = crypto.getRandomValues(new Uint8Array(12));

			// Encrypt the data with AES
			const encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, dataBuffer);

			// Export the AES key
			const exportedAesKey = await crypto.subtle.exportKey("raw", aesKey);

			// Encrypt the AES key with RSA
			const rsaCryptoKey = await crypto.subtle.importKey(
				"jwk",
				rsaPublicKey,
				{ name: "RSA-OAEP", hash: "SHA-256" },
				true,
				["encrypt"]
			);

			const encryptedAesKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaCryptoKey, exportedAesKey);

			// Combine IV + encrypted AES key + encrypted data
			const combined = new Uint8Array(iv.length + encryptedAesKey.byteLength + encryptedData.byteLength);
			combined.set(iv, 0);
			combined.set(new Uint8Array(encryptedAesKey), iv.length);
			combined.set(new Uint8Array(encryptedData), iv.length + encryptedAesKey.byteLength);

			return this.bufferToBase64(combined.buffer);
		} catch (error) {
			throw new CryptoKeysError("Failed to encrypt large data", error);
		}
	}

	/**
	 * Decrypts a base64 encrypted JSON data using hybrid decryption (RSA + AES)
	 * @param {string} encryptedData - The encrypted data in base64 format
	 * @returns {Promise<any>} The decrypted JSON object
	 * @throws {CryptoKeysError} If decryption fails
	 */
	async decryptToJSON(encryptedData) {
		try {
			await this.waitForLoad();

			const rsaPrivateKey = await Settings.get("crypto.rsaPrivateKey");
			if (!rsaPrivateKey) {
				await this.#generateKeypair();
				const newRsaPrivateKey = await Settings.get("crypto.rsaPrivateKey");
				if (!newRsaPrivateKey) {
					throw new CryptoKeysError("Failed to generate RSA private key for decryption");
				}
			}

			// Convert base64 to buffer
			const encryptedBuffer = this.base64ToBuffer(encryptedData);

			// Check if this is hybrid encrypted data (larger than typical RSA output)
			// RSA-OAEP with 2048-bit key produces 256 bytes of output
			if (encryptedBuffer.byteLength > 256) {
				return await this.#decryptLargeData(encryptedBuffer, rsaPrivateKey);
			}

			// Import the RSA private key
			const cryptoKey = await crypto.subtle.importKey(
				"jwk",
				rsaPrivateKey,
				{
					name: "RSA-OAEP",
					hash: "SHA-256",
				},
				true,
				["decrypt"]
			);

			// Decrypt the data directly with RSA
			const decryptedBuffer = await crypto.subtle.decrypt(
				{
					name: "RSA-OAEP",
				},
				cryptoKey,
				encryptedBuffer
			);

			// Convert buffer back to JSON object
			const decoder = new TextDecoder();
			return JSON.parse(decoder.decode(decryptedBuffer));
		} catch (error) {
			throw new CryptoKeysError("Failed to decrypt data: ", error);
		}
	}

	/**
	 * Decrypts large data using hybrid decryption (RSA + AES)
	 * @param {ArrayBuffer} encryptedBuffer - The encrypted data
	 * @param {object} rsaPrivateKey - The RSA private key JWK
	 * @returns {Promise<any>} The decrypted JSON object
	 */
	async #decryptLargeData(encryptedBuffer, rsaPrivateKey) {
		try {
			const encryptedArray = new Uint8Array(encryptedBuffer);

			// Extract IV (first 12 bytes)
			const iv = encryptedArray.slice(0, 12);

			// Extract encrypted AES key (next 256 bytes for RSA-OAEP)
			const encryptedAesKey = encryptedArray.slice(12, 12 + 256);

			// Extract encrypted data (remaining bytes)
			const encryptedData = encryptedArray.slice(12 + 256);

			// Decrypt the AES key with RSA
			const rsaCryptoKey = await crypto.subtle.importKey(
				"jwk",
				rsaPrivateKey,
				{ name: "RSA-OAEP", hash: "SHA-256" },
				true,
				["decrypt"]
			);

			const decryptedAesKeyBuffer = await crypto.subtle.decrypt(
				{ name: "RSA-OAEP" },
				rsaCryptoKey,
				encryptedAesKey
			);

			// Import the decrypted AES key
			const aesKey = await crypto.subtle.importKey("raw", decryptedAesKeyBuffer, { name: "AES-GCM" }, true, [
				"encrypt",
				"decrypt",
			]);

			// Decrypt the data with AES
			const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, encryptedData);

			// Convert buffer back to JSON object
			const decoder = new TextDecoder();
			return JSON.parse(decoder.decode(decryptedBuffer));
		} catch (error) {
			throw new CryptoKeysError("Failed to decrypt large data", error);
		}
	}
}

export { CryptoKeys };

const DB_NAME = "guided-selfie";
const DB_VERSION = 1;
const STORE_NAME = "photos";

export class PhotoStore {
	constructor() {
		this.dbPromise = null;
	}

	/**
	 * Initialize database connection.
	 * @returns {Promise<IDBDatabase>}
	 */
	async init() {
		if (this.dbPromise) {
			return this.dbPromise;
		}

		if (!("indexedDB" in window)) {
			throw new Error("IndexedDB is not supported in this browser");
		}

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, {
						keyPath: "id",
						autoIncrement: true,
					});
					store.createIndex("createdAt", "createdAt", { unique: false });
				}
			};

			request.onsuccess = () => {
				resolve(request.result);
			};

			request.onerror = () => {
				reject(request.error || new Error("Failed to open database"));
			};
		});

		return this.dbPromise;
	}

	/**
	 * Add a photo blob to the store.
	 * @param {Blob} blob
	 * @returns {Promise<{id: number, createdAt: number}>}
	 */
	async addPhoto(blob) {
		const db = await this.init();
		const createdAt = Date.now();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.add({ blob, createdAt });

			request.onsuccess = () => {
				resolve({ id: request.result, createdAt });
			};

			request.onerror = () => {
				reject(request.error || new Error("Failed to add photo"));
			};
		});
	}

	/**
	 * Delete a photo by id.
	 * @param {number} id
	 * @returns {Promise<void>}
	 */
	async deletePhoto(id) {
		const db = await this.init();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.delete(id);
			request.onsuccess = () => resolve();
			request.onerror = () => {
				reject(request.error || new Error("Failed to delete photo"));
			};
		});
	}

	/**
	 * Get all photos ordered by createdAt ascending.
	 * @returns {Promise<Array<{id: number, blob: Blob, createdAt: number}>>}
	 */
	async getAllPhotos() {
		const db = await this.init();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const index = store.index("createdAt");
			const request = index.getAll();

			request.onsuccess = () => {
				const result = request.result || [];
				resolve(result);
			};

			request.onerror = () => {
				reject(request.error || new Error("Failed to get photos"));
			};
		});
	}
}

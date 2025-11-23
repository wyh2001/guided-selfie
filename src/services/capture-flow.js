/* 
Extracted from main.js into this module for better readability with GitHub Copilot's help.
*/
export async function performCapture(ctx) {
	const {
		effects,
		segmentationService,
		photoService,
		photoStore,
		statusEl,
		storedPhotos,
		refreshAlbumThumbnail,
	} = ctx;
	statusEl.textContent = "Capturing…";
	try {
		let blob;
		if (effects.isBlurOn) {
			// Use blur canvas if available
			const blurCanvas = segmentationService.getLatestBlurCanvas?.();
			if (blurCanvas) {
				blob = await new Promise((resolve, reject) => {
					const exportCanvas = document.createElement("canvas");
					exportCanvas.width = blurCanvas.width;
					exportCanvas.height = blurCanvas.height;
					const ectx = exportCanvas.getContext("2d");
					if (!ectx) {
						reject(new Error("Canvas context unavailable"));
						return;
					}
					ectx.save();
					if (photoService.getFacingMode() === "user") {
						ectx.translate(exportCanvas.width, 0);
						ectx.scale(-1, 1);
					}
					ectx.drawImage(blurCanvas, 0, 0);
					ectx.restore();
					exportCanvas.toBlob(
						(b) => (b ? resolve(b) : reject(new Error("Export failed"))),
						"image/jpeg",
						1.0,
					);
				});
			} else {
				// Fallback raw capture
				({ blob } = await photoService.captureWithBlob());
			}
		} else {
			({ blob } = await photoService.captureWithBlob());
		}

		const url = URL.createObjectURL(blob);
		try {
			const { id, createdAt } = await photoStore.addPhoto(blob);
			storedPhotos.push({ id, url, createdAt });
			refreshAlbumThumbnail();
		} catch (storageError) {
			console.error("Failed to persist photo:", storageError);
			try {
				URL.revokeObjectURL(url);
			} catch (_) {}
		}
		statusEl.textContent = "Photo saved";
		setTimeout(() => {
			statusEl.textContent = "Look at the camera";
		}, 1000);
		return url;
	} catch (error) {
		statusEl.textContent = `Capture failed: ${error.message}`;
		throw error;
	}
}

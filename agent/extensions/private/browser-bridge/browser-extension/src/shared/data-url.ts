export function dataUrlToBlob(dataUrl: string): Blob {
	const commaIndex = dataUrl.indexOf(",");
	if (!dataUrl.startsWith("data:") || commaIndex < 0) throw new Error("Invalid preview data URL.");
	const metadata = dataUrl.slice(5, commaIndex);
	const encoded = dataUrl.slice(commaIndex + 1);
	const mediaType = metadata.split(";")[0] || "application/octet-stream";
	const isBase64 = metadata.split(";").includes("base64");
	if (!isBase64) return new Blob([new TextEncoder().encode(decodeURIComponent(encoded))], { type: mediaType });
	const text = atob(encoded.replace(/\s/g, ""));
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
	return new Blob([bytes], { type: mediaType });
}

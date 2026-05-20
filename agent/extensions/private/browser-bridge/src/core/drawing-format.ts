import type { BrowserDrawingBoxSummary, BrowserDrawingPreviewSummary, BrowserDrawingStrokeSummary, BrowserDrawingViewportSummary, BrowserElementDescriptorSummary, BrowserSelectionContextSummary, BrowserSharedDrawingSummary } from "./state.ts";

export function formatDrawingGeometry(drawing: BrowserSharedDrawingSummary): string[] {
	const lines: string[] = [];
	if (drawing.boundingBox) {
		const pageBox = drawing.pageBoundingBox ?? pageBoxFromContext(drawing.boundingBox, drawing.context);
		lines.push(`  region: viewport ${formatBox(drawing.boundingBox)}${pageBox ? `; page ${formatBox(pageBox)}` : ""}`);
	}
	const viewport = drawing.viewport ?? viewportFromContext(drawing.context);
	if (viewport) {
		const size = viewport.width !== undefined && viewport.height !== undefined ? `${formatNumber(viewport.width)}x${formatNumber(viewport.height)}` : "unknown size";
		const scroll = viewport.scrollX !== undefined && viewport.scrollY !== undefined ? ` scroll ${formatNumber(viewport.scrollX)},${formatNumber(viewport.scrollY)}` : "";
		const dpr = viewport.devicePixelRatio !== undefined ? ` dpr ${formatDecimal(viewport.devicePixelRatio)}` : "";
		lines.push(`  viewport: ${size}${scroll}${dpr}`);
	}
	const preview = formatPreviewGeometry(drawing.previewImage);
	if (preview) lines.push(`  preview crop: ${preview}`);
	return lines;
}

export function formatStrokeRegions(drawing: BrowserSharedDrawingSummary): string[] {
	const regions = drawing.strokes.map((stroke) => formatStrokeRegion(stroke, drawing)).filter((line): line is string => Boolean(line));
	return regions.length <= 1 ? [] : ["  regions:", ...regions.map((line, index) => `  ${index + 1}. ${line}`)];
}

export function isRootOnlyDrawingTarget(drawing: BrowserSharedDrawingSummary): boolean {
	const candidates = [drawing.gesture?.fromElement, drawing.gesture?.toElement, ...drawing.nearbyElements].filter((element): element is BrowserElementDescriptorSummary => Boolean(element));
	return candidates.length > 0 && candidates.every(isRootElement);
}

function formatPreviewGeometry(preview: BrowserDrawingPreviewSummary | undefined): string | undefined {
	if (!preview?.crop && !preview?.imageSize) return undefined;
	const parts: string[] = [];
	if (preview.crop) parts.push(`${preview.crop.coordinateSpace ?? "viewport"} ${formatBox(preview.crop)}`);
	if (preview.imageSize) parts.push(`image ${formatNumber(preview.imageSize.width)}x${formatNumber(preview.imageSize.height)}`);
	const scale = preview.scale ?? scaleFromPreview(preview);
	if (scale) parts.push(`scale ${formatScale(scale)}`);
	return parts.join("; ");
}

function formatStrokeRegion(stroke: BrowserDrawingStrokeSummary, drawing: BrowserSharedDrawingSummary): string | undefined {
	if (!stroke.boundingBox) return undefined;
	const pageBox = stroke.pageBoundingBox ?? pageBoxFromContext(stroke.boundingBox, drawing.context);
	return `viewport ${formatBox(stroke.boundingBox)}${pageBox ? `; page ${formatBox(pageBox)}` : ""}`;
}

function pageBoxFromContext(box: BrowserDrawingBoxSummary, context: BrowserSelectionContextSummary | undefined): BrowserDrawingBoxSummary | undefined {
	const scrollX = numberFromContext(context, "scrollX");
	const scrollY = numberFromContext(context, "scrollY");
	return scrollX === undefined || scrollY === undefined ? undefined : { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, coordinateSpace: "page" };
}

function viewportFromContext(context: BrowserSelectionContextSummary | undefined): BrowserDrawingViewportSummary | undefined {
	const viewport: BrowserDrawingViewportSummary = {
		width: numberFromContext(context, "viewportWidth"),
		height: numberFromContext(context, "viewportHeight"),
		scrollX: numberFromContext(context, "scrollX"),
		scrollY: numberFromContext(context, "scrollY"),
		devicePixelRatio: numberFromContext(context, "devicePixelRatio"),
	};
	return Object.values(viewport).some((value) => value !== undefined) ? viewport : undefined;
}

function scaleFromPreview(preview: BrowserDrawingPreviewSummary): { x: number; y: number } | undefined {
	if (!preview.crop || !preview.imageSize || preview.crop.width === 0 || preview.crop.height === 0) return undefined;
	return { x: preview.imageSize.width / preview.crop.width, y: preview.imageSize.height / preview.crop.height };
}

function formatScale(scale: { x: number; y: number }): string {
	return Math.abs(scale.x - scale.y) < 0.05 ? `${formatDecimal((scale.x + scale.y) / 2)}x` : `${formatDecimal(scale.x)}x/${formatDecimal(scale.y)}y`;
}

function formatBox(box: BrowserDrawingBoxSummary): string {
	return `x=${formatNumber(box.x)} y=${formatNumber(box.y)} w=${formatNumber(box.width)} h=${formatNumber(box.height)}`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatDecimal(value: number): string {
	return value.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function numberFromContext(context: BrowserSelectionContextSummary | undefined, key: string): number | undefined {
	const value = context?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRootElement(element: BrowserElementDescriptorSummary): boolean {
	const tag = element.tagName?.toLowerCase();
	const firstSelector = element.selectorCandidates?.[0]?.toLowerCase();
	return tag === "html" || tag === "body" || firstSelector === "html" || firstSelector === "body";
}

export function truncateObjectFields(obj: unknown, maxLength = 500): unknown {
	if (obj === null || obj === undefined) {
		return obj;
	}
	if (typeof obj === "string") {
		return obj.length > maxLength ? `${obj.slice(0, maxLength)}...` : obj;
	}
	if (typeof obj !== "object") {
		return obj;
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => truncateObjectFields(item, maxLength));
	}
	const truncated: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		truncated[key] = truncateObjectFields(value, maxLength);
	}
	return truncated;
}


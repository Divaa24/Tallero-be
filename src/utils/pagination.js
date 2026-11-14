// ==============================================================================
// TALLERO AUTO — PAGINATION & SORT UTILITIES
// Sesuai AGENTS.md §3:
// - Default page = 1, default limit = 20, batas maksimal limit = 100
// - Sort wajib divalidasi dengan whitelist
// ==============================================================================

export const parsePagination = (query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const rawLimit = Number.parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(Math.max(1, rawLimit), maxLimit);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

export const buildPaginationMeta = ({ page, limit, total }) => {
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    page,
    limit,
    total,
    totalPages,
  };
};

export const parseSort = (sortString, allowedFields = [], defaultSort = { createdAt: "desc" }) => {
  if (!sortString || typeof sortString !== "string") {
    return defaultSort;
  }

  let field = sortString;
  let direction = "asc";

  if (sortString.includes(":")) {
    const [f, dir] = sortString.split(":");
    field = f.trim();
    direction = dir.toLowerCase() === "desc" ? "desc" : "asc";
  } else if (sortString.startsWith("-")) {
    field = sortString.slice(1).trim();
    direction = "desc";
  }

  if (!allowedFields.includes(field)) {
    return defaultSort;
  }

  return { [field]: direction };
};

export default {
  parsePagination,
  buildPaginationMeta,
  parseSort,
};

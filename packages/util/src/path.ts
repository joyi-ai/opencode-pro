export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

/**
 * Truncate common directory prefixes from paths.
 * Removes prefixes like /Users/<user>/, /home/<user>/, C:\Users\<user>\
 * Unless the path IS the prefix itself (e.g., just /Users/rahul).
 */
export function truncateDirectoryPrefix(path: string): string {
  if (!path) return ""

  // Normalize to forward slashes for consistent matching
  const normalized = path.replace(/\\/g, "/")

  // Common prefixes to remove (order matters - more specific first)
  const prefixes = [
    // WSL paths (\\wsl.localhost\Ubuntu\home\user\ or //wsl.localhost/Ubuntu/home/user/)
    /^\/\/wsl\.localhost\/[^/]+\/home\/[^/]+\//i,
    // WSL$ paths (\\wsl$\Ubuntu\home\user\)
    /^\/\/wsl\$\/[^/]+\/home\/[^/]+\//i,
    // Windows with drive letter (C:/Users/... or c:/Users/...)
    /^[a-zA-Z]:\/[Uu]sers\/[^/]+\//,
    // Windows MSYS/Git Bash style (/c/Users/...)
    /^\/[a-zA-Z]\/[Uu]sers\/[^/]+\//,
    // macOS (/Users/...)
    /^\/[Uu]sers\/[^/]+\//,
    // Linux (/home/...)
    /^\/home\/[^/]+\//,
    // Windows Documents and Settings (older)
    /^[a-zA-Z]:\/Documents and Settings\/[^/]+\//i,
  ]

  for (const prefix of prefixes) {
    const match = normalized.match(prefix)
    if (match) {
      // Check if the path IS the prefix itself (with or without trailing slash)
      const prefixWithoutSlash = match[0].replace(/\/$/, "")
      const pathWithoutSlash = normalized.replace(/\/$/, "")
      if (pathWithoutSlash === prefixWithoutSlash) {
        // The path IS the prefix, don't truncate - return original
        return path
      }
      // Remove the prefix, preserving original slash style
      const result = normalized.slice(match[0].length)
      // Restore backslashes if original had them
      if (path.includes("\\")) {
        return result.replace(/\//g, "\\")
      }
      return result
    }
  }

  return path
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(/[\/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(".")
  return parts[parts.length - 1]
}

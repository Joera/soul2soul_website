import { helpers } from "./handlebars-helpers";
import { decode } from "html-entities";

interface TemplateData {
  [key: string]: any;
}

interface Partial {
  path: string;
  cid: string;
}

// Get value from templateData using dot notation and array access
const getNestedValue = (path: string, data: TemplateData): any => {
  if (!data) return undefined;

  // Handle array access with dot notation: path.to.[0].property
  const parts = path.split(".");
  const result = parts.reduce((obj, key) => {
    if (!obj) return undefined;

    // Handle array index access: [0]
    if (key.startsWith("[") && key.endsWith("]")) {
      const index = parseInt(key.slice(1, -1));
      return Array.isArray(obj) ? obj[index] : undefined;
    }

    return obj[key];
  }, data);

  return result;
};

// Get value from context, handling special variables and this
const getContextValue = (path: string, context: TemplateData): any => {
  const trimmedPath = path.trim();

  // Handle special variables
  if (trimmedPath === "@root") return context;
  if (
    trimmedPath === "@first" ||
    trimmedPath === "@last" ||
    trimmedPath === "@index"
  ) {
    return context[trimmedPath];
  }

  // Handle this keyword
  if (trimmedPath === "this") {
    return context.this || context;
  }

  // Try getting from this first if it exists
  if (context.this && typeof context.this === "object") {
    const fromThis = getNestedValue(trimmedPath, context.this);
    if (fromThis !== undefined) {
      return fromThis;
    }
  }

  // Fall back to root context
  return getNestedValue(trimmedPath, context);
};

// Process variables in the template
const processVariables = (text: string, context: TemplateData): string => {
  if (!text.includes("{{")) return text;

  let result = text;

  // Handle triple braces first (unescaped HTML)
  const triplePattern = /{{{([^}]+)}}}/g;
  result = result.replace(triplePattern, (match, path) => {
    const value = getContextValue(path.trim(), context);
    return value !== undefined ? String(value) : "";
  });

  // Then handle double braces (escaped)
  const doublePattern = /{{([^#/>][^}]*)}}/g;
  result = result.replace(doublePattern, (match, path) => {
    const value = getContextValue(path.trim(), context);
    return value !== undefined ? escapeHtml(String(value)) : "";
  });

  return result;
};

// Process block helpers like {{#if}}, {{#each}}, etc.
const processBlockHelpers = (text: string, context: TemplateData): string => {
  // Skip if no block helpers
  if (!text.includes("{{#")) return text;

  let result = text;

  // Process if blocks first
  const ifPattern =
    /{{#if\s+([^}]+)}}\s*([\s\S]*?)(?:{{else}}\s*([\s\S]*?))?{{\/if}}/g;
  result = result.replace(
    ifPattern,
    (match, condition, content, elseContent = "") => {
      try {
        const trimmedCondition = condition.trim();

        // Handle eq helper in if blocks
        if (trimmedCondition.startsWith("(eq ")) {
          const argsStr = trimmedCondition.slice(4, -1).trim();
          const args = argsStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

          if (args.length === 2) {
            const [arg1, arg2] = args;
            const val1 = arg1.startsWith('"')
              ? arg1.slice(1, -1)
              : arg1.startsWith("'")
                ? arg1.slice(1, -1)
                : getContextValue(arg1, context);
            const val2 = arg2.startsWith('"')
              ? arg2.slice(1, -1)
              : arg2.startsWith("'")
                ? arg2.slice(1, -1)
                : getContextValue(arg2, context);

            return val1 === val2
              ? processTemplate(content, context)
              : elseContent
                ? processTemplate(elseContent, context)
                : "";
          }
        }

        // Handle regular conditions
        const value = getContextValue(trimmedCondition, context);
        return value
          ? processTemplate(content, context)
          : elseContent
            ? processTemplate(elseContent, context)
            : "";
      } catch (error) {
        console.error("Error in if block:", error);
        return "";
      }
    },
  );

  // Process each blocks
  const withPattern =
    /{{#with\s+([^}]+)(?:\s+as\s+\|([^|]+)\|)?}}\s*([\s\S]*?){{\/with}}/g;
  result = result.replace(withPattern, (match, expression, alias, content) => {
    try {
      // Get the value from the expression
      let value;

      // Check if the expression is a helper call
      if (expression.includes(" ")) {
        const [helperName, ...args] = expression
          .split(" ")
          .map((part) => part.trim());
        const helper = helperMap.get(helperName);

        if (helper) {
          // Resolve args from context
          const resolvedArgs = args.map((arg) => {
            if (arg.startsWith('"') && arg.endsWith('"'))
              return arg.slice(1, -1);
            if (arg.startsWith("'") && arg.endsWith("'"))
              return arg.slice(1, -1);
            return getContextValue(arg, context);
          });

          value = helper(...resolvedArgs);
        } else {
          value = getContextValue(expression, context);
        }
      } else {
        value = getContextValue(expression, context);
      }

      if (value === undefined || value === null) {
        return "";
      }

      // Create a new context with the value
      const withContext = { ...context };

      if (alias) {
        // If alias is provided, set the value under that name
        withContext[alias] = value;
      } else {
        // Otherwise, spread properties if it's an object
        if (typeof value === "object" && !Array.isArray(value)) {
          Object.assign(withContext, value);
        } else {
          withContext.this = value;
        }
      }

      return processTemplate(content, withContext);
    } catch (error) {
      console.error("Error in with block:", error);
      return "";
    }
  });

  // Process each blocks
  const eachPattern = /{{#each\s+([^}]+)}}\s*([\s\S]*?){{\/each}}/g;
  result = result.replace(eachPattern, (match, arrayPath, content) => {
    const array = getContextValue(arrayPath.trim(), context);
    if (!Array.isArray(array)) {
      console.error("Each block array not found or not an array:", arrayPath);
      return "";
    }

    return array
      .map((item, index) => {
        // Create a context with special variables while preserving parent context
        const itemContext = {
          ...context, // Keep parent context
          this: item, // Set current item as 'this'
          "@index": index,
          "@first": index === 0,
          "@last": index === array.length - 1,
          "@key": arrayPath.split(".").pop() || "",
          ...item, // Spread item properties at top level
        };

        return processTemplate(content, itemContext);
      })
      .join("");
  });

  return result;
};

// Create a map of helpers for faster lookup
const helperMap = new Map(helpers.map((h) => [h.name, h.helper]));

// Process helpers in the template
const processHelpers = (text: string, context: TemplateData): string => {
  // Match both double and triple braces
  const helperRegex = /{{{?\s*(\w+)\s+([^}]+)}}}?/g;
  return text.replace(helperRegex, (match, helperName, args) => {
    // Skip block helpers and partials
    if (match.startsWith("{{#") || match.startsWith("{{>")) {
      return match;
    }

    const helper = helperMap.get(helperName);
    if (!helper) return match;

    try {
      // Split args and resolve context values
      const resolvedArgs = args.split(" ").map((arg) => {
        const trimmed = arg.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1);
        }
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
          return trimmed.slice(1, -1);
        }
        return getContextValue(trimmed, context);
      });

      // Call the helper with resolved arguments
      const result = helper(...resolvedArgs);
      return result !== undefined ? String(result) : "";
    } catch (error) {
      console.error(`Error processing helper ${helperName}:`, error);
      return "";
    }
  });
};

export const processTemplate = (
  text: string,
  context: TemplateData,
): string => {
  if (!text) return "";

  // Process in specific order: blocks first, then helpers, then variables
  let result = text;
  result = processBlockHelpers(result, context);
  result = processHelpers(result, context);
  result = processVariables(result, context);
  return result;
};

export const cleanTemplateString = (content: string): string => {
  if (!content) return "";
  return decode(content)
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/^"/, "") // Remove leading quote
    .replace(/"$/, "") // Remove trailing quote
    .replace(/(?<=>)"\s*/g, "") // Remove quotes and spaces after >
    .replace(/\s*"(?=<)/g, "") // Remove quotes and spaces before <
    .trim();
};

export const processPartials = async (
  template: string,
  partials: Partial[],
  templateData: TemplateData,
): Promise<string> => {
  // First fetch and clean all partials
  const processedPartials: { [key: string]: string } = {};

  for (const partial of partials) {
    try {
      const response = await fetch(
        `https://ipfs.transport-union.dev/api/v0/cat?arg=${partial.cid}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) continue;

      let content = await response.text();
      content = cleanTemplateString(content);

      // Get filename without path or extension
      const name = partial.path
        .substring(partial.path.lastIndexOf("/") + 1)
        .split(".")[0];
      processedPartials[name] = content;
    } catch (error) {
      continue;
    }
  }

  // Then recursively replace partials in template
  let html = template;
  let depth = 0;
  let changed = true;

  while (changed && depth < 10) {
    // Max 10 levels of nesting
    changed = false;
    for (const [name, content] of Object.entries(processedPartials)) {
      const regex = new RegExp(`{{\\s*>\\s*${name}\\s*}}`, "g");
      if (regex.test(html)) {
        // Clean the content again after replacing to handle any nested quotes
        html = html.replace(regex, content);
        changed = true;
      }
    }
    depth++;
    // Clean any quotes that might have been introduced
    html = cleanTemplateString(html);
  }

  // Process the complete template after all partials are inserted
  return processTemplate(html, templateData);
};

// HTML escape function
const escapeHtml = (str: string): string => {
  const htmlEscapes: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
};

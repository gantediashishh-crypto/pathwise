(function attachPathwiseApi(root) {
  "use strict";

  function createApi(fetchImplementation) {
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }

    async function request(route, options = {}) {
      const requestOptions = {
        method: options.method || "GET",
        credentials: "same-origin",
        headers: {}
      };
      if (options.body !== undefined) {
        requestOptions.headers["Content-Type"] = "application/json";
        requestOptions.body = JSON.stringify(options.body);
      }

      const response = await fetchImplementation(route, requestOptions);
      if (response.status === 204) return null;

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("The server returned an invalid response.");
      }
      if (!response.ok) {
        const message = payload && typeof payload.error === "string"
          ? payload.error
          : "The request could not be completed.";
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    return Object.freeze({ request });
  }

  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({ createApi });
  } else {
    root.PathwiseApi = createApi(root.fetch.bind(root));
  }
})(globalThis);

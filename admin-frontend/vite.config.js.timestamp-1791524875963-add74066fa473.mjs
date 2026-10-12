// vite.config.js
import { defineConfig } from "file:///G:/PrintAlfa/admin-frontend/node_modules/vite/dist/node/index.js";
import react from "file:///G:/PrintAlfa/admin-frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///G:/PrintAlfa/admin-frontend/node_modules/@tailwindcss/vite/dist/index.mjs";
import path from "path";
var __vite_injected_original_dirname = "G:\\PrintAlfa\\admin-frontend";
var vite_config_default = defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    global: "globalThis"
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  server: {
    port: 5174,
    // Never watch the packaged-installer output: electron:build rewrites it
    // while the dev server runs, which crashes Vite's file watcher (EBUSY).
    watch: {
      ignored: ["**/dist-electron-build/**", "**/dist-electron/**"]
    },
    proxy: {
      "/api": {
        target: "http://localhost:8085",
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJHOlxcXFxQcmludEFsZmFcXFxcYWRtaW4tZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkc6XFxcXFByaW50QWxmYVxcXFxhZG1pbi1mcm9udGVuZFxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRzovUHJpbnRBbGZhL2FkbWluLWZyb250ZW5kL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ0B0YWlsd2luZGNzcy92aXRlJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBiYXNlOiAnLi8nLFxuXG4gIHBsdWdpbnM6IFtyZWFjdCgpLCB0YWlsd2luZGNzcygpXSxcblxuICBkZWZpbmU6IHtcbiAgICBnbG9iYWw6ICdnbG9iYWxUaGlzJyxcbiAgfSxcblxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJyksXG4gICAgfSxcbiAgfSxcblxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTc0LFxuICAgIC8vIE5ldmVyIHdhdGNoIHRoZSBwYWNrYWdlZC1pbnN0YWxsZXIgb3V0cHV0OiBlbGVjdHJvbjpidWlsZCByZXdyaXRlcyBpdFxuICAgIC8vIHdoaWxlIHRoZSBkZXYgc2VydmVyIHJ1bnMsIHdoaWNoIGNyYXNoZXMgVml0ZSdzIGZpbGUgd2F0Y2hlciAoRUJVU1kpLlxuICAgIHdhdGNoOiB7XG4gICAgICBpZ25vcmVkOiBbJyoqL2Rpc3QtZWxlY3Ryb24tYnVpbGQvKionLCAnKiovZGlzdC1lbGVjdHJvbi8qKiddLFxuICAgIH0sXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjgwODUnLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQXlRLFNBQVMsb0JBQW9CO0FBQ3RTLE9BQU8sV0FBVztBQUNsQixPQUFPLGlCQUFpQjtBQUN4QixPQUFPLFVBQVU7QUFIakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBLEVBRU4sU0FBUyxDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUM7QUFBQSxFQUVoQyxRQUFRO0FBQUEsSUFDTixRQUFRO0FBQUEsRUFDVjtBQUFBLEVBRUEsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBRUEsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBO0FBQUE7QUFBQSxJQUdOLE9BQU87QUFBQSxNQUNMLFNBQVMsQ0FBQyw2QkFBNkIscUJBQXFCO0FBQUEsSUFDOUQ7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

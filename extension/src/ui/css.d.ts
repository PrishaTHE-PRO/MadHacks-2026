// esbuild loads .css files as text (build.mjs), for <style> tags in shadow roots.
declare module "*.css" {
  const css: string;
  export default css;
}

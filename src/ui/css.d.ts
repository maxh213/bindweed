declare module "*.css";

declare module "*.css?raw" {
  const sheet: string;
  export default sheet;
}

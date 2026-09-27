// Image numbering shared by the director, export and API (the client mirrors it in public/app.js).
// @Image1 = model and @Image2 = main product are always reserved so prompts stay stable when an
// image is uploaded later; extra product angles and style references take @Image3 onwards.

export const ASSET_ROLES = {
  model: { label: '模特', max: 1 },
  product: { label: '衣服 / 商品', max: 3 },
  style: { label: '效果参考', max: 3 },
};

export function refMap(assets = []) {
  const of = role => assets.filter(a => a.role === role);
  const [model] = of('model');
  const [mainProduct, ...angles] = of('product');
  const refs = [
    { token: '@Image1', role: 'model', file: model?.file || null, label: '替换模特' },
    { token: '@Image2', role: 'product', file: mainProduct?.file || null, label: '替换衣服 / 商品' },
  ];
  let n = 3;
  for (const a of angles) refs.push({ token: `@Image${n++}`, role: 'product', file: a.file, label: '衣服 / 商品补充角度' });
  for (const a of of('style')) refs.push({ token: `@Image${n++}`, role: 'style', file: a.file, label: '效果参考' });
  return refs;
}

// practice datasets that carry a license notice (pure: no DOM, unit-tested). Shown on the page while the dataset is open
// (sample-credit-ui.js) and written next to the data (docs/demo/<id>/README.md and LICENSE). Texts are i18n keys (i18n.js).
export const SAMPLE_CREDITS=Object.freeze({
 sample5:Object.freeze({
  sourceKey:'creditMarmosetSource',sourceUrl:'https://www.scidb.cn/en/file?fid=6444dd2f292d4e32b96ea092&mode=front',
  licenseName:'CC BY-NC-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  changesKey:'creditMarmosetChanges',termsKey:'creditMarmosetTerms',
 }),
});
export const sampleCredit=id=>typeof id==='string'&&Object.hasOwn(SAMPLE_CREDITS,id)?SAMPLE_CREDITS[id]:null;

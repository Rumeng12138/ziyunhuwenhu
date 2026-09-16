// Compile JSX at build time. Source: frontend/index.html; deploy: public/index.html.
const fs = require('node:fs');
const path = require('node:path');
const {transform}=require(require.resolve('sucrase',{paths:[path.join(__dirname,'..'),path.dirname(require.resolve('tailwindcss/package.json'))]}));
const source=fs.readFileSync(path.join(__dirname,'../../frontend/index.html'),'utf8');
const match=source.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if(!match)throw Error('Storefront JSX source missing');
const code=transform(match[1],{transforms:['jsx'],production:true,disableESTransforms:true}).code;
new (require('node:vm').Script)(code); // Fail the build before replacing a working artifact.
const output=source.replace(match[0],()=>'<script>\n'+code+'\n</script>')
  .replace(/^.*<script src="[^"\n]*@babel\/standalone[^\n]*\n/gm,'');
fs.writeFileSync(path.join(__dirname,'../public/index.html'),output);
console.log('Storefront compiled. Browser Babel is not needed by the deployment page.');

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAndroidApkIdentity, parseAndroidApkIdentity } from '../../../scripts/dev/beta-apk-identity.mjs';
const identity=iteration=>({identifier:'com.exomind.app.v06.beta',versionCode:6000+iteration,versionName:`0.6.0-beta${iteration}`});
const badging=value=>`package: name='${value.identifier}' versionCode='${value.versionCode}' versionName='${value.versionName}' platformBuildVersionName='16'\napplication-label:'ExoMind Beta'\n`;
for(const iteration of [18,19,20])test(`checks Beta${iteration} as values without a copied version regular expression`,()=>{
  const expected=identity(iteration);
  assert.deepEqual(assertAndroidApkIdentity(badging(expected),expected),expected);
});
for(const [field,value] of [['identifier','com.example.other'],['versionCode',6018],['versionName','0.6.0-beta18']])test(`rejects a different ${field}`,()=>{
  const expected=identity(19);
  assert.throws(()=>assertAndroidApkIdentity(badging({...expected,[field]:value}),expected),new RegExp(field));
});
test('rejects missing or ambiguous package headers without reporting the whole tool output',()=>{
  assert.throws(()=>parseAndroidApkIdentity('native-code: arm64-v8a'),/one package header/);
  assert.throws(()=>parseAndroidApkIdentity(badging(identity(19))+badging(identity(20))),/one package header/);
});

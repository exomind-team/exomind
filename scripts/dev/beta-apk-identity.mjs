/** Parse aapt's package header; expected versions come from the pinned config. */
export function parseAndroidApkIdentity(badging) {
  const headers=[...badging.matchAll(/^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']*)'/gm)];
  if(headers.length!==1)throw new Error('Expected exactly one package header in Android badging');
  const [,identifier,code,versionName]=headers[0];
  const versionCode=Number(code);
  if(!Number.isSafeInteger(versionCode)||versionCode<=0)throw new Error('Invalid Android versionCode');
  return {identifier,versionCode,versionName};
}

export function assertAndroidApkIdentity(badging,expected) {
  const actual=parseAndroidApkIdentity(badging);
  for(const field of ['identifier','versionCode','versionName']){
    if(actual[field]!==expected[field])throw new Error(`Android ${field} mismatch: expected ${expected[field]}, got ${actual[field]}`);
  }
  return actual;
}

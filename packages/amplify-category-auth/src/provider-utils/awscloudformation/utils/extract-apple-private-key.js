const PRIVATE_KEY_REGEX = /(-+BEGINPRIVATEKEY-+)(.+[^-])(-+ENDPRIVATEKEY-+)/;

function extractApplePrivateKey(key) {
  // Remove spaces and new lines
  let keyString = key.replace(/[\r\n\s]+/g, '');

  // Removes key comments, get key from group 2
  const matches = keyString.match(PRIVATE_KEY_REGEX);
  if (matches && matches[2]) {
    keyString = matches[2];
  }
  return keyString;
}

module.exports = {
  extractApplePrivateKey,
};

const { fail } = require('./commerce');

function text(value, name, { required = true, min = 0, max = 200, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${name}不能为空`);
    return '';
  }
  if (typeof value !== 'string') fail(`${name}格式不正确`);
  const result = trim ? value.trim() : value;
  if (required && result.length < Math.max(1, min)) fail(`${name}不能为空`);
  if (result.length < min || result.length > max) fail(`${name}长度应为${min}至${max}个字符`);
  return result;
}

function optionalText(value, name, max = 200) {
  return text(value ?? '', name, { required: false, max });
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) fail(`${name}无效`);
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') fail(`${name}必须为布尔值`);
  return value;
}

function id(value, name = 'ID') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${name}无效`);
  return parsed;
}

module.exports = { text, optionalText, oneOf, boolean, id };

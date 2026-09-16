const { fail } = require('./commerce');
module.exports = function pagination(query, defaultSize = 20) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? defaultSize);
  if (!Number.isSafeInteger(page) || page<1 || page>1000000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>100) fail('分页参数无效（每页1至100条）');
  return {page,pageSize,offset:(page-1)*pageSize};
};

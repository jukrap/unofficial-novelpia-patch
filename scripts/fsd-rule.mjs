import path from 'node:path';
const layers = ['shared', 'entities', 'features', 'widgets', 'pages', 'app', 'entrypoints'];
function parts(file) {
  const items = file.replaceAll('\\', '/').split('/');
  const i = items.lastIndexOf('src');
  return i < 0 ? null : items.slice(i + 1);
}
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      direction: 'FSD: 하위 계층만 import할 수 있습니다.',
      slice: 'FSD: 같은 계층의 다른 slice를 참조할 수 없습니다.',
      public: 'FSD: 다른 slice의 공개 index를 사용하세요.',
    },
  },
  create(context) {
    const source = parts(context.filename);
    if (!source || !layers.includes(source[0])) return {};
    function check(node, literal = node.source) {
      const specifier = literal?.value;
      if (typeof specifier !== 'string') return;
      const target = specifier.startsWith('@/')
        ? specifier.slice(2).split('/')
        : specifier.startsWith('.')
          ? parts(path.resolve(path.dirname(context.filename), specifier))
          : null;
      if (!target || !layers.includes(target[0])) return;
      if (layers.indexOf(target[0]) > layers.indexOf(source[0]))
        context.report({ node, messageId: 'direction' });
      const sliced = ['entities', 'features', 'widgets', 'pages'];
      if (target[0] === source[0] && sliced.includes(source[0]) && target[1] !== source[1])
        context.report({ node, messageId: 'slice' });
      if (
        sliced.includes(target[0]) &&
        (target[0] !== source[0] || target[1] !== source[1]) &&
        target.length > 2 &&
        target[2] !== 'index'
      )
        context.report({ node, messageId: 'public' });
    }
    return {
      ImportDeclaration: (node) => check(node),
      ExportNamedDeclaration: (node) => check(node),
      ExportAllDeclaration: (node) => check(node),
      ImportExpression: (node) => check(node),
    };
  },
};

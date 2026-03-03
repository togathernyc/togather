module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@features': './features',
            '@components': './components',
            '@services': './services',
            '@utils': './utils',
            '@types': './types',
            '@providers': './providers',
            '@hooks': './hooks',
            '@': './',
          },
        },
      ],
    ],
  };
};


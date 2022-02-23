return function()
  require'nvim-treesitter.configs'.setup {
    highlight = {
      enable = true,
      disable = {},
    },
    indent = {
      enable = false,
      disable = {},
    },
    ensure_installed = {
      "css",
      "graphql",
      "html",
      "java",
      "javascript",
      "json",
      "lua",
      "python",
      "ruby",
      "tsx",
      "typescript"
    },
  }
end

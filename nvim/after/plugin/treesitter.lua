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
    "tsx",
    "javascript",
    "lua",
    "python",
    "json",
    "typescript",
    "ruby",
    "html",
    "css"
  },
}

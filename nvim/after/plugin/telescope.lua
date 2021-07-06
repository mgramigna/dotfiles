local actions = require('telescope.actions')
require('telescope').setup{
  defaults = {
    mappings = {
      n = {
        ["q"] = actions.close
      },
    },
  }
}

vim.api.nvim_set_keymap('n', '<C-t>', ':Telescope find_files<cr>', { noremap = true, silent = true})
vim.api.nvim_set_keymap('n', '<C-r>', ':Telescope live_grep<cr>', { noremap = true, silent = true})
vim.api.nvim_set_keymap('n', '<C-b>', ':Telescope buffers<cr>', { noremap = true, silent = true})

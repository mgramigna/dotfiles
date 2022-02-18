return function()
  local actions = require('telescope.actions')
  local builtin = require('telescope.builtin')
  require('telescope').setup{
    defaults = {
      mappings = {
        n = {
          ["q"] = actions.close
        },
      },
      file_ignore_patterns = { '^.git/' }
    },
    pickers = {
      find_files = {
        theme = "dropdown"
      },
      live_grep = {
        theme = "dropdown"
      },
      grep_string = {
        theme = "dropdown"
      },
      buffers = {
        theme = "dropdown"
      },
      treesitter = {
        theme = "dropdown"
      },
      spell_suggest = {
        theme = "cursor"
      },
      lsp_code_actions = {
        theme = "cursor"
      }
    }
  }

  vim.api.nvim_set_keymap('n', '<C-t>', ":lua require'telescope.builtin'.find_files({ hidden = true })<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-s>', ":lua require'telescope.builtin'.live_grep()<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-b>', ":lua require'telescope.builtin'.buffers()<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>do', ":lua require'telescope.builtin'.lsp_code_actions()<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>t', ":lua require'telescope.builtin'.treesitter()<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>s', ":lua require'telescope.builtin'.grep_string()<cr>", { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>x', ":lua require'telescope.builtin'.spell_suggest()<cr>", { noremap = true, silent = true})
end

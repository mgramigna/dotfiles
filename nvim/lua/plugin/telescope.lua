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
    }
  }

  function _G.telescope_find_files()
    builtin.find_files({ hidden = true })
  end

  function _G.telescope_live_grep()
    builtin.live_grep()
  end

  function _G.telescope_buffers()
    builtin.buffers()
  end

  function _G.telescope_code_actions()
    builtin.lsp_code_actions()
  end

  function _G.telescope_treesitter()
    builtin.treesitter()
  end

  function _G.telescope_grep_string()
    builtin.grep_string()
  end

  vim.api.nvim_set_keymap('n', '<C-t>', ':lua telescope_find_files()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-s>', ':lua telescope_live_grep()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-b>', ':lua telescope_buffers()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>do', ':lua telescope_code_actions()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>t', ':lua telescope_treesitter()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<leader>s', ':lua telescope_grep_string()<cr>', { noremap = true, silent = true})
end

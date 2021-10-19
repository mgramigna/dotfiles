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

  vim.api.nvim_set_keymap('n', '<C-t>', ':lua telescope_find_files()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-s>', ':lua telescope_live_grep()<cr>', { noremap = true, silent = true})
  vim.api.nvim_set_keymap('n', '<C-b>', ':lua telescope_buffers()<cr>', { noremap = true, silent = true})
end

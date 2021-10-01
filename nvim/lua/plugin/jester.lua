return function()
  vim.api.nvim_set_keymap('n', '<leader>t', ':lua require"jester".run()<cr>', { silent = true })
  vim.api.nvim_set_keymap('n', '<leader>tf', ':lua require"jester".run_file()<cr>', { silent = true })
  vim.api.nvim_set_keymap('n', '<leader>tl', ':lua require"jester".run_last()<cr>', { silent = true })
end

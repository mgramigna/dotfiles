vim.api.nvim_create_autocmd('BufEnter,BufRead',
  { pattern = '*.cql', command = "set filetype=cql" })

vim.api.nvim_create_autocmd('BufEnter,BufRead',
  { pattern = '*.fsh', command = "set filetype=fsh" })

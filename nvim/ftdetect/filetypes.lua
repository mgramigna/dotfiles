local custom_files_group = vim.api.nvim_create_augroup("CustomFiles", { clear = true })

vim.api.nvim_create_autocmd(
	"BufEnter,BufRead",
	{ group = custom_files_group, pattern = "*.cql", command = "set filetype=cql" }
)
vim.api.nvim_create_autocmd(
	"BufEnter,BufRead",
	{ group = custom_files_group, pattern = "*.fsh", command = "set filetype=fsh" }
)

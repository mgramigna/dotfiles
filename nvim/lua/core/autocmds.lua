vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, { pattern = { "*.md" }, command = "setlocal spell" })
vim.api.nvim_create_autocmd("TermOpen", {
	callback = function()
		vim.opt_local.number = false
		vim.opt_local.relativenumber = false
	end,
})

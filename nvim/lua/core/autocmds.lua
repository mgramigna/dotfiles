vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, { pattern = { "*.md" }, command = "setlocal spell" })
vim.api.nvim_create_autocmd("TermOpen", {
	callback = function()
		vim.opt_local.number = false
		vim.opt_local.relativenumber = false
	end,
})

if vim.fn.executable("pdflatex") == 1 then
	vim.api.nvim_create_autocmd("BufWritePost", {
		pattern = { "*.tex" },
		callback = function()
			vim.cmd("silent exec '!pdflatex %'")
			if vim.v.shell_error == 1 then
				vim.notify("Error compiling " .. vim.fn.expand("%") .. " (see log)", vim.log.levels.ERROR)
			else
				vim.notify("Successfully compiled " .. vim.fn.expand("%") .. " to pdf", vim.log.levels.INFO)
			end
		end,
	})
end

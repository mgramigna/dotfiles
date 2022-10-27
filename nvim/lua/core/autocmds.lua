local local_opt_group = vim.api.nvim_create_augroup("LocalOpts", { clear = true })

vim.api.nvim_create_autocmd(
	{ "BufRead", "BufNewFile" },
	{ group = local_opt_group, pattern = { "*.md" }, command = "setlocal spell" }
)
vim.api.nvim_create_autocmd(
	{ "BufRead", "BufNewFile" },
	{ group = local_opt_group, pattern = { "*.cql" }, command = "setlocal nospell" }
)
vim.api.nvim_create_autocmd("TermOpen", {
	group = local_opt_group,
	callback = function()
		vim.opt_local.number = false
		vim.opt_local.relativenumber = false
		vim.opt_local.spell = false
	end,
})

local latex_group = vim.api.nvim_create_augroup("Latex", { clear = true })

if vim.fn.executable("pdflatex") == 1 then
	vim.api.nvim_create_autocmd("BufWritePost", {
		group = latex_group,
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

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

local function visual_selection_range()
	local _, csrow, cscol, _ = unpack(vim.fn.getpos("'<"))
	local _, cerow, cecol, _ = unpack(vim.fn.getpos("'>"))
	if csrow < cerow or (csrow == cerow and cscol <= cecol) then
		return csrow - 1, cscol - 1, cerow - 1, cecol
	else
		return cerow - 1, cecol - 1, csrow - 1, cscol
	end
end

_G.console_log_under_cursor = function()
	local csrow, cscol, cerow, cecol = visual_selection_range()
	local t = vim.api.nvim_buf_get_text(0, csrow, cscol, cerow, cecol, {})

	local s = ""

	for _, v in pairs(t) do
		s = s .. v .. ""
	end

	local pos = vim.api.nvim_win_get_cursor(0)
	vim.api.nvim_buf_set_lines(0, pos[1], pos[1], false, { "console.log(" .. s .. ");" })
end

_G.console_log_blank = function()
	local pos = vim.api.nvim_win_get_cursor(0)
	vim.api.nvim_buf_set_lines(0, pos[1] - 1, pos[1] - 1, false, { "console.log();" })
	vim.api.nvim_win_set_cursor(0, { pos[1], pos[2] + 11 })
end

local cl_group = vim.api.nvim_create_augroup("ConsoleLog", { clear = true })

vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
	group = cl_group,
	pattern = { "*.ts", "*.js", "*.jsx", "*.tsx" },
	callback = function()
		vim.api.nvim_set_keymap(
			"v",
			"<leader>cl",
			":lua console_log_under_cursor()<CR>",
			{ noremap = true, silent = true }
		)
	end,
})

vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
	group = cl_group,
	pattern = { "*.ts", "*.js", "*.jsx", "*.tsx" },
	callback = function()
		vim.api.nvim_set_keymap("n", "<leader>cl", ":lua console_log_blank()<CR>", { noremap = true, silent = true })
	end,
})

local hl_yank_group = vim.api.nvim_create_augroup("HighlightYank", { clear = true })

vim.api.nvim_create_autocmd("TextYankPost", {
	group = hl_yank_group,
	callback = function()
		vim.highlight.on_yank({ on_visual = false })
	end,
})

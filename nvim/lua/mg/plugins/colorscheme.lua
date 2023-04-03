return {
	"Mofiqul/dracula.nvim",
	lazy = false,
	priority = 1000,
	config = function()
		local colors = require("dracula").colors()
		vim.cmd.colorscheme("dracula")
		vim.cmd("hi SpellBad gui=undercurl guifg=none guibg=none guisp=" .. colors["cyan"])
	end,
}

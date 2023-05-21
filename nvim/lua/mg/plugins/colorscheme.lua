return {
	"Mofiqul/dracula.nvim",
	lazy = false,
	priority = 1000,
	config = function()
		local colors = require("dracula").colors()

		require("dracula").setup({
			italic_comment = true,
		})

		vim.cmd.colorscheme("dracula")
		vim.cmd("hi SpellBad gui=undercurl guifg=none guibg=none guisp=" .. colors["cyan"])
	end,
}

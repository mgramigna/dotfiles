return function()
	require("nvim-treesitter.configs").setup({
		ensure_installed = "all",
		highlight = { enable = true, disable = {} },
		indent = { enable = false, disable = {} },
		rainbow = {
			enable = true,
		},
	})
end

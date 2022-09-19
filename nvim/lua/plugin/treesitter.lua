return function()
	require("nvim-treesitter.configs").setup({
		ensure_installed = {
			"javascript",
			"json",
			"lua",
			"tsx",
			"typescript",
			"java",
		},
		highlight = { enable = true, disable = {} },
		indent = { enable = false, disable = {} },
		rainbow = {
			enable = true,
			disable = { "jsx", "tsx", "html" },
		},
	})
end

return function()
	require("nvim-treesitter.configs").setup({
		ensure_installed = "all",
		ignore_install = { "phpdoc" },
		highlight = { enable = true, disable = {} },
		indent = { enable = false, disable = {} },
		rainbow = {
			enable = true,
			disable = { "jsx", "tsx", "html" },
		},
	})
end

local execute = vim.api.nvim_command

local fn = vim.fn

local install_path = fn.stdpath("data") .. "/site/pack/packer/start/packer.nvim"

if fn.empty(fn.glob(install_path)) > 0 then
	fn.system({
		"git",
		"clone",
		"https://github.com/wbthomason/packer.nvim",
		install_path,
	})
	execute("packadd packer.nvim")
end

local packer = require("packer")
return packer.startup(function(use)
	-- Packer
	use({
		"wbthomason/packer.nvim",
	})

	-- LSP
	use({
		"williamboman/mason.nvim",
		"williamboman/mason-lspconfig.nvim",
		"neovim/nvim-lspconfig",
	})

	use({
		"glepnir/lspsaga.nvim",
		branch = "main",
	})

	-- Completion
	use({ "rafamadriz/friendly-snippets" })

	use({
		"hrsh7th/nvim-cmp",
		requires = {
			"hrsh7th/cmp-nvim-lsp",
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
			"L3MON4D3/LuaSnip",
			"saadparwaiz1/cmp_luasnip",
			"onsails/lspkind.nvim",
		},
		after = "friendly-snippets",
	})

	-- Formatting
	use({ "mhartington/formatter.nvim" })

	-- Treesitter Misc
	use({
		"nvim-treesitter/nvim-treesitter",
		run = ":TSUpdate",
	})

	use({ "p00f/nvim-ts-rainbow", requires = "nvim-treesitter/nvim-treesitter" })

	use({
		"nvim-treesitter/nvim-treesitter-context",
		requires = "nvim-treesitter/nvim-treesitter",
	})

	use({
		"windwp/nvim-ts-autotag",
		requires = { "nvim-treesitter/nvim-treesitter" },
	})

	use("nvim-treesitter/playground")

	use({
		"phelipetls/jsonpath.nvim",
	})

	use("JoosepAlviste/nvim-ts-context-commentstring")

	-- Appearance
	use("kyazdani42/nvim-web-devicons")
	use({ "nvim-lualine/lualine.nvim" })
	use({
		"dracula/vim",
		as = "dracula",
		config = function()
			vim.cmd("colorscheme dracula")
			vim.cmd("hi SpellBad cterm=underline")
		end,
	})
	use({
		"j-hui/fidget.nvim",
	})
	use({
		"goolord/alpha-nvim",
	})
	use("folke/zen-mode.nvim")

	-- Editing Keybinds
	use("tpope/vim-commentary")
	use("tpope/vim-surround")
	use({
		"ggandor/leap.nvim",
	})

	-- Files
	use({ "nvim-telescope/telescope-fzf-native.nvim", run = "make" })

	use({
		"nvim-telescope/telescope.nvim",
		tag = "0.1.0",
		requires = { "nvim-lua/plenary.nvim" },
	})

	use("theprimeagen/harpoon")

	-- Git
	use("tpope/vim-fugitive")
	use({
		"lewis6991/gitsigns.nvim",
		requires = { "nvim-lua/plenary.nvim" },
	})
	use({
		"sindrets/diffview.nvim",
		requires = "nvim-lua/plenary.nvim",
	})

	-- Markdown
	use({ "npxbr/glow.nvim", run = ":GlowInstall" })
	use({
		"iamcco/markdown-preview.nvim",
		run = function()
			fn["mkdp#util#install"]()
		end,
		ft = { "markdown" },
	})

	use("mbbill/undotree")
end)

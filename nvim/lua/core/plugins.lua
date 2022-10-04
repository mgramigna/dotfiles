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
		config = function()
			vim.api.nvim_set_keymap("n", "<leader>ps", ":PackerSync<cr>", { noremap = true })
			vim.api.nvim_set_keymap("n", "<leader>pc", ":PackerCompile<cr>", { noremap = true })
		end,
	})

	-- Improve Startuptime
	use("lewis6991/impatient.nvim")

	-- LSP
	use({
		"neovim/nvim-lspconfig",
		config = require("plugin.lspconfig"),
		requires = { "williamboman/nvim-lsp-installer" },
	})

	use({
		"glepnir/lspsaga.nvim",
		branch = "main",
	})

	-- UI
	use({
		"stevearc/dressing.nvim",
		config = require("plugin.dressing"),
		requires = { "nvim-telescope/telescope.nvim" },
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
		config = require("plugin.cmp"),
		after = "friendly-snippets",
	})

	-- Formatting
	use({ "mhartington/formatter.nvim", config = require("plugin.formatter") })

	-- Treesitter Misc
	use({
		"nvim-treesitter/nvim-treesitter",
		run = ":TSUpdate",
		config = require("plugin.treesitter"),
	})

	use({ "p00f/nvim-ts-rainbow", requires = "nvim-treesitter/nvim-treesitter" })
	use({
		"nvim-treesitter/nvim-treesitter-context",
		requires = "nvim-treesitter/nvim-treesitter",
		config = function()
			require("treesitter-context").setup()
		end,
	})
	use({
		"windwp/nvim-ts-autotag",
		requires = { "nvim-treesitter/nvim-treesitter" },
		config = function()
			require("nvim-ts-autotag").setup()
		end,
	})
	use("nvim-treesitter/playground")

	-- Appearance
	use("kyazdani42/nvim-web-devicons")
	use({ "nvim-lualine/lualine.nvim", config = require("plugin.lualine") })
	use({ "dracula/vim", as = "dracula" })

	-- Editing Keybinds
	use("b3nj5m1n/kommentary")
	use("tpope/vim-surround")
	use({
		"ggandor/leap.nvim",
		config = function()
			require("leap").set_default_keymaps()
		end,
	})

	-- Files
	use({ "nvim-telescope/telescope-fzf-native.nvim", run = "make" })

	use({
		"nvim-telescope/telescope.nvim",
		tag = "0.1.0",
		config = require("plugin.telescope"),
		requires = { "nvim-lua/popup.nvim", "nvim-lua/plenary.nvim" },
	})

	use({ "kyazdani42/nvim-tree.lua", config = require("plugin.nvim-tree") })

	-- Git
	use("tpope/vim-fugitive")
	use({
		"lewis6991/gitsigns.nvim",
		requires = { "nvim-lua/plenary.nvim" },
		config = require("plugin.gitsigns"),
	})
	use({
		"sindrets/diffview.nvim",
		requires = "nvim-lua/plenary.nvim",
		config = require("plugin.diffview"),
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

	-- Editing Simplicity
	use({ "beauwilliams/focus.nvim", config = require("plugin.focus") })
	use({ "karb94/neoscroll.nvim", config = require("plugin.neoscroll") })
end)

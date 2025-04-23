return {
	{
		"williamboman/mason.nvim",
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufRead",
		dependencies = {
			{
				"mrcjkb/rustaceanvim",
				version = "^5",
				ft = { "rust" },
			},
			{
				"marilari88/twoslash-queries.nvim",
				config = function()
					require("twoslash-queries").setup({
						multi_line = true,
					})

					vim.keymap.set("n", "<leader>ti", "<cmd>TwoslashQueriesInspect<cr>", { noremap = true })
				end,
			},
			{
				"j-hui/fidget.nvim",
				opts = {},
			},
			{
				"williamboman/mason-lspconfig.nvim",
				config = function()
					---@diagnostic disable-next-line: missing-fields
					require("mason-lspconfig").setup({
						ensure_installed = {
							"astro",
							"eslint",
							"jdtls",
							"lua_ls",
							"prismals",
							"pylsp",
							"rust_analyzer",
							"tailwindcss",
							"texlab",
							"vtsls"
						},
					})
				end,
			},
			{
				"folke/neodev.nvim",
				config = function()
					require("neodev").setup()
				end,
			},
			{ "saghen/blink.cmp" },
			{ "yioneko/nvim-vtsls" }
		},
		config = function()
			local lspconfig = require("lspconfig")

			local diagnostic_icons = {
				Error = "󰅚 ",
				Warn = "󰀪 ",
				Info = "•",
				Hint = "•",
			}

			vim.diagnostic.config({
				float = {
					source = true,
					severity_sort = true,
				},
				jump = {
					severity = { min = vim.diagnostic.severity.W },
				},
				virtual_text = {
					severity = { min = vim.diagnostic.severity.HINT },
				},
				underline = false,
				severity_sort = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = diagnostic_icons.Error,
						[vim.diagnostic.severity.WARN] = diagnostic_icons.Warn,
						[vim.diagnostic.severity.INFO] = diagnostic_icons.Info,
						[vim.diagnostic.severity.HINT] = diagnostic_icons.Hint,
					},
					numhl = {
						[vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
						[vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
					},
				},
			})

			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
					vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
					vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
					vim.keymap.set("n", "gt", vim.lsp.buf.type_definition, opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)

					vim.keymap.set("n", "gr", function()
						require("telescope.builtin").lsp_references()
					end, opts)

					vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float)
					vim.keymap.set("n", "[g", function()
						vim.diagnostic.jump({ count = -1, float = true })
					end)
					vim.keymap.set("n", "]g", function()
						vim.diagnostic.jump({ count = 1, float = true })
					end)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
					vim.keymap.set("n", "<leader>do", vim.lsp.buf.code_action, opts)

					local eslint_group = vim.api.nvim_create_augroup("EslintFix", { clear = true })
					vim.keymap.set("n", "<leader>ef", "<cmd>EslintFixAll<cr>", { noremap = true })

					vim.api.nvim_create_autocmd("BufWritePre", {
						group = eslint_group,
						callback = function()
							if vim.fn.exists(":EslintFixAll") > 0 then
								vim.cmd("EslintFixAll")
							end
						end,
					})
				end,
			})

			local capabilities = require("blink.cmp").get_lsp_capabilities()

			require("mason-lspconfig").setup_handlers({
				function(server_name)
					lspconfig[server_name].setup({
						capabilities = capabilities,
					})
				end,

				["vtsls"] = function()
					require("lspconfig.configs").vtsls = require("vtsls").lspconfig

					lspconfig.vtsls.setup({
						capabilities = capabilities,
						on_attach = function(client, bufnr)
							require("twoslash-queries").attach(client, bufnr)
						end,
						typescript = {
							tsserver = {
								maxTsServerMemory = 12288,
							},
						},
					})
				end,

				["rust_analyzer"] = function()
					vim.g.rustaceanvim = {
						tools = {},
						server = {
							default_settings = {
								["rust-analyzer"] = {},
							},
						},
					}
				end,

				["lua_ls"] = function()
					lspconfig["lua_ls"].setup({
						capabilities = capabilities,
						settings = {
							Lua = {
								completion = {
									callSnippet = "Replace",
								},
							},
						},
					})
				end,

				["pylsp"] = function()
					lspconfig["pylsp"].setup({
						capabilities = capabilities,
						settings = {
							pylsp = {
								plugins = {
									pycodestyle = {
										ignore = { "E501", "W503" },
									},
								},
							},
						},
					})
				end,

				["eslint"] = function()
					lspconfig["eslint"].setup({
						capabilities = capabilities,
						flags = {
							allow_incremental_sync = false,
							debounce_text_changes = 1000,
						},
					})
				end,

				["tailwindcss"] = function()
					lspconfig["tailwindcss"].setup({
						capabilities = capabilities,
						flags = {
							allow_incremental_sync = false,
							debounce_text_changes = 1000,
						},
					})
				end,
			})
		end,
	},
}
